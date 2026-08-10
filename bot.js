import { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOKEN = process.env.DISCORD_TOKEN || 'MTUyMzc2NTM5MzY4Mjg1ODA0OA.GE8PTn.kcYvGggU1x7PKo-HDTuhqAowwDfuDkThX9j-Us';
const GUILD_ID = process.env.GUILD_ID || '1442592660853625038';
const INVITE = process.env.INVITE_URL || 'https://discord.gg/uSSGpABkMT';

const CHANNELS = {
  helper: process.env.CH_HELPER || '1536510809981845686',
  moderator: process.env.CH_MODERATOR || '1536510900742127787',
  reports: '1524186097180086355',
  supportStats: '1524198456607117332',
  modStats: '1523152195523186739',
  vacation: '1524846250854318140',
  welcome: process.env.CH_WELCOME || '1442592660853625043',
  shop: process.env.CH_SHOP || null
};

const ROLE_NAMES = {
  helper: 'Helper',
  moderator: 'Moderator'
};

const MOD_ROLE_ID = '1442598138761314376';
const SUPPORT_ROLE_ID = '1524203277863096411';
const WELCOME_ROLE_ID = process.env.WELCOME_ROLE || null;

const DATA_DIR = __dirname;
const TICKET_FILE = join(DATA_DIR, 'ticket_counter.json');
const VOICE_FILE = join(DATA_DIR, 'voice_time.json');
const CURRENCY_FILE = join(DATA_DIR, 'currency.json');
const GIVEAWAY_FILE = join(DATA_DIR, 'giveaways.json');
const REACTION_ROLES_FILE = join(DATA_DIR, 'reaction_roles.json');

function loadJSON(file, fallback) {
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch {}
  }
  return fallback;
}

function saveJSON(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2));
}

let ticketCounter = loadJSON(TICKET_FILE, { count: 1 }).count || 1;
function nextTicket() {
  const n = ticketCounter++;
  saveJSON(TICKET_FILE, { count: ticketCounter });
  return n;
}

let voiceData = loadJSON(VOICE_FILE, {});
let currencyData = loadJSON(CURRENCY_FILE, {});
let giveawayData = loadJSON(GIVEAWAY_FILE, { active: [], ended: [] });
let reactionRoleData = loadJSON(REACTION_ROLES_FILE, {});

function saveVoiceData() { saveJSON(VOICE_FILE, voiceData); }
function saveCurrencyData() { saveJSON(CURRENCY_FILE, currencyData); }
function saveGiveawayData() { saveJSON(GIVEAWAY_FILE, giveawayData); }
function saveReactionRoleData() { saveJSON(REACTION_ROLES_FILE, reactionRoleData); }

const voiceJoinTimes = {};
const VOICE_NORM_MS = 2 * 60 * 60 * 1000;

function getTodayKey() { return new Date().toISOString().slice(0, 10); }

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return `${hours}h ${minutes}m`;
}

function getDailyData(userId) {
  const today = getTodayKey();
  if (!voiceData[userId]) voiceData[userId] = { username: '', daily: {} };
  if (!voiceData[userId].daily[today]) voiceData[userId].daily[today] = { ms: 0, sessions: [] };
  return voiceData[userId].daily[today];
}

function getCurrency(userId) {
  if (!currencyData[userId]) currencyData[userId] = { coins: 0, daily: null, streak: 0 };
  return currencyData[userId];
}

function addCoins(userId, amount) {
  const data = getCurrency(userId);
  data.coins += amount;
  saveCurrencyData();
  return data;
}

async function postStatsTable(roleId, channelId) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const today = getTodayKey();
  const members = await guild.members.fetch();
  const roleMembers = members.filter(m => m.roles.cache.has(roleId));
  if (roleMembers.size === 0) return;

  const rows = [];
  for (const [, member] of roleMembers) {
    const data = voiceData[member.id];
    let dailyMs = 0;
    if (data && data.daily[today]) dailyMs = data.daily[today].ms;
    const status = dailyMs >= VOICE_NORM_MS ? '✅' : '❌';
    rows.push({ name: member.displayName || member.user.username, time: formatDuration(dailyMs), status });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const description = rows.map(r => `${r.status} **${r.name}** — ${r.time}`).join('\n');
  const aboveNorm = rows.filter(r => r.status === '✅').length;
  const belowNorm = rows.filter(r => r.status === '❌').length;

  const embed = new EmbedBuilder()
    .setTitle(`Voice Stats — ${today}`)
    .setColor(0x60a5fa)
    .setDescription(description || 'No data for today')
    .addFields(
      { name: 'Above norm (2h+)', value: `${aboveNorm}`, inline: true },
      { name: 'Below norm', value: `${belowNorm}`, inline: true }
    )
    .setTimestamp();

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel) {
    const lastMsg = await channel.messages.fetch({ limit: 1 }).catch(() => null);
    const last = lastMsg?.first();
    if (last && last.author.id === client.user.id && last.embeds[0]?.title?.startsWith('Voice Stats')) {
      await last.edit({ embeds: [embed] }).catch(() => {});
    } else {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

let client;
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function findUserByDiscord(discordName, guild) {
  try {
    const raw = discordName.toLowerCase().replace(/#\d+$/, '').trim();
    const clean = raw.replace(/[^a-z0-9]/g, '');
    const g = guild || await client.guilds.fetch(GUILD_ID);
    await g.members.fetch();
    return g.members.cache.find(m => {
      const uname = (m.user.username || '').toLowerCase();
      const gname = (m.nick || m.user.global_name || '').toLowerCase();
      return uname === raw || gname === raw ||
             uname.replace(/[^a-z0-9]/g, '') === clean ||
             gname.replace(/[^a-z0-9]/g, '') === clean ||
             uname.startsWith(raw) || gname.startsWith(raw);
    }) || null;
  } catch { return null; }
}

async function sendDM(userId, embed) {
  try {
    const dm = await rest.post(Routes.userChannels(), { body: { recipient_id: userId } });
    await rest.post(Routes.channelMessages(dm.id), { body: { embeds: [embed] } });
    return true;
  } catch { return false; }
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => res.send('OK'));

app.post('/apply', async (req, res) => {
  try {
    const { role, name, discord, age, experience, reason, extra } = req.body;
    if (!role || !name || !discord) return res.json({ ok: false, error: 'Заполните имя и Discord' });

    const embed = new EmbedBuilder()
      .setTitle(`Новая заявка на ${ROLE_NAMES[role] || role}`)
      .setColor(0xc52b3a)
      .addFields(
        { name: 'Имя', value: name, inline: true },
        { name: 'Discord', value: discord, inline: true },
        { name: 'Возраст', value: age || '—', inline: true },
        { name: 'Опыт', value: experience || '—', inline: true },
        { name: 'Почему', value: reason || '—' },
        { name: 'Дополнительно', value: extra || '—' }
      )
      .setFooter({ text: 'REZ · Заявки' })
      .setTimestamp(new Date());

    const safeTag = discord.replace(/[^a-zA-Z0-9_#]/g, '').substring(0, 32);
    const timestamp = Date.now();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`a_${role}_${safeTag}_${timestamp}`).setStyle(ButtonStyle.Secondary).setEmoji('✅'),
      new ButtonBuilder().setCustomId(`r_${role}_${safeTag}_${timestamp}`).setStyle(ButtonStyle.Secondary).setEmoji('❌')
    );

    const channel = await client.channels.fetch(CHANNELS[role]);
    if (!channel) return res.json({ ok: false, error: 'Канал не найден' });
    await channel.send({ embeds: [embed], components: [row] });
    res.json({ ok: true });
  } catch (e) {
    console.error('/apply error:', e);
    res.json({ ok: false, error: 'Ошибка сервера' });
  }
});

app.post('/vacation', async (req, res) => {
  try {
    const { discord, dateFrom, dateTo, reason } = req.body;
    if (!discord || !dateFrom || !dateTo) return res.json({ ok: false, error: 'Заполните все обязательные поля' });

    const embed = new EmbedBuilder()
      .setTitle('Заявка на отпуск')
      .setColor(0xf87171)
      .addFields(
        { name: 'Discord', value: discord, inline: true },
        { name: 'С', value: dateFrom, inline: true },
        { name: 'По', value: dateTo, inline: true },
        { name: 'Причина', value: reason || '—' }
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vac_accept_${discord.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now()}`).setStyle(ButtonStyle.Success).setLabel('Принять'),
      new ButtonBuilder().setCustomId(`vac_reject_${discord.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now()}`).setStyle(ButtonStyle.Danger).setLabel('Отклонить')
    );

    const channel = await client.channels.fetch(CHANNELS.vacation);
    if (!channel) return res.json({ ok: false, error: 'Канал не найден' });
    await channel.send({ embeds: [embed], components: [row] });
    res.json({ ok: true });
  } catch (e) {
    console.error('/vacation error:', e);
    res.json({ ok: false, error: 'Ошибка сервера' });
  }
});

app.get('/api/voice', async (req, res) => {
  try {
    const today = getTodayKey();
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    const modMembers = members.filter(m => m.roles.cache.has(MOD_ROLE_ID));
    const supportMembers = members.filter(m => m.roles.cache.has(SUPPORT_ROLE_ID));
    const result = { mods: [], support: [], date: today };

    for (const [, m] of modMembers) {
      const d = voiceData[m.id];
      const ms = d && d.daily[today] ? d.daily[today].ms : 0;
      result.mods.push({ username: m.displayName || m.user.username, avatar: m.user.displayAvatarURL({ dynamic: true }), timeMs: ms, sessions: d && d.daily[today] ? d.daily[today].sessions.length : 0 });
    }
    for (const [, m] of supportMembers) {
      const d = voiceData[m.id];
      const ms = d && d.daily[today] ? d.daily[today].ms : 0;
      result.support.push({ username: m.displayName || m.user.username, avatar: m.user.displayAvatarURL({ dynamic: true }), timeMs: ms, sessions: d && d.daily[today] ? d.daily[today].sessions.length : 0 });
    }
    result.mods.sort((a, b) => b.timeMs - a.timeMs);
    result.support.sort((a, b) => b.timeMs - a.timeMs);
    res.json(result);
  } catch (e) {
    console.error('/api/voice error:', e);
    res.json({ mods: [], support: [], date: getTodayKey() });
  }
});

app.get('/api/currency', async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();
    const leaderboard = Object.entries(currencyData)
      .map(([id, data]) => {
        const member = guild.members.cache.get(id);
        return { id, username: member ? (member.displayName || member.user.username) : 'Unknown', coins: data.coins, streak: data.streak || 0 };
      })
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 20);
    res.json({ leaderboard, date: getTodayKey() });
  } catch (e) {
    res.json({ leaderboard: [], date: getTodayKey() });
  }
});

client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions
  ]
});

client.once('ready', async () => {
  console.log(`Bot started as ${client.user.tag}`);
  console.log(`Guild: ${GUILD_ID}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Create a support ticket')
      .addStringOption(o => o.setName('description').setDescription('Describe your issue or question').setRequired(true)),

    new SlashCommandBuilder()
      .setName('voicestats')
      .setDescription('Show voice channel time stats for support and admin')
      .addUserOption(o => o.setName('user').setDescription('Check specific user (optional)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin — heads or tails')
      .addIntegerOption(o => o.setName('bet').setDescription('Bet amount (optional)').setRequired(false).setMinValue(1)),

    new SlashCommandBuilder()
      .setName('dice')
      .setDescription('Roll a dice (1-6)')
      .addIntegerOption(o => o.setName('sides').setDescription('Number of sides (default 6)').setRequired(false).setMinValue(2).setMaxValue(100)),

    new SlashCommandBuilder()
      .setName('rps')
      .setDescription('Rock-Paper-Scissors')
      .addStringOption(o => o.setName('choice').setDescription('Your choice').setRequired(true).addChoices(
        { name: '🪨 Rock', value: 'rock' },
        { name: '📄 Paper', value: 'paper' },
        { name: '✂️ Scissors', value: 'scissors' }
      )),

    new SlashCommandBuilder()
      .setName('daily')
      .setDescription('Claim your daily coin reward'),

    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Check your coin balance')
      .addUserOption(o => o.setName('user').setDescription('Check another user').setRequired(false)),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show top 10 richest users'),

    new SlashCommandBuilder()
      .setName('give')
      .setDescription('Give coins to another user')
      .addUserOption(o => o.setName('user').setDescription('Who to give coins to').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount of coins').setRequired(true).setMinValue(1)),

    new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Create a poll')
      .addStringOption(o => o.setName('question').setDescription('The poll question').setRequired(true))
      .addStringOption(o => o.setName('options').setDescription('Options separated by | (max 10)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Start a giveaway')
      .addStringOption(o => o.setName('prize').setDescription('What to give away').setRequired(true))
      .addIntegerOption(o => o.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(1))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(false).setMinValue(1).setMaxValue(10)),

    new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the magic 8-ball')
      .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),

    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('View the item shop'),

    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy an item from the shop')
      .addStringOption(o => o.setName('item').setDescription('Item name').setRequired(true)),

    new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Play the slot machine')
      .addIntegerOption(o => o.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(10)),

    new SlashCommandBuilder()
      .setName('setreactionrole')
      .setDescription('Set up reaction roles on a message (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName('messageid').setDescription('Message ID to add reaction roles to').setRequired(true))
      .addStringOption(o => o.setName('roles').setDescription('Format: emoji:roleId,emoji:roleId,...').setRequired(true)),

    new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Send a welcome embed to the welcome channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Embed description (use {user} for mention)').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color (e.g. #ff0000)').setRequired(false))
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Slash commands registered');
  } catch (e) {
    console.error('Command registration error:', e.message);
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    if (WELCOME_ROLE_ID) {
      await member.roles.add(WELCOME_ROLE_ID).catch(() => {});
    }

    const channel = await client.channels.fetch(CHANNELS.welcome).catch(() => null);
    if (!channel) return;

    const memberCount = member.guild.memberCount;
    const ordinal = memberCount % 10 === 1 && memberCount % 100 !== 11 ? 'st' :
                    memberCount % 10 === 2 && memberCount % 100 !== 12 ? 'nd' :
                    memberCount % 10 === 3 && memberCount % 100 !== 13 ? 'rd' : 'th';

    const embed = new EmbedBuilder()
      .setTitle(`Welcome to ${member.guild.name}!`)
      .setDescription(
        `Hey ${member}, welcome to **${member.guild.name}**!\n\n` +
        `You are our **${memberCount}${ordinal}** member.\n\n` +
        `> Enjoy your stay and check out the rules!`
      )
      .setColor(0x60a5fa)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error('Welcome error:', e);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const member = newState.member || oldState.member;
    if (!member) return;
    const hasMod = member.roles.cache.has(MOD_ROLE_ID);
    const hasSupport = member.roles.cache.has(SUPPORT_ROLE_ID);
    if (!hasMod && !hasSupport) return;
    const userId = member.id;

    if (!voiceData[userId]) voiceData[userId] = { username: member.user.username, daily: {} };
    voiceData[userId].username = member.user.username;

    const wasInVoice = !!oldState.channelId;
    const isInVoice = !!newState.channelId;

    if (!wasInVoice && isInVoice) voiceJoinTimes[userId] = Date.now();

    if (wasInVoice && !isInVoice) {
      const joinTime = voiceJoinTimes[userId];
      if (joinTime) {
        const duration = Date.now() - joinTime;
        const daily = getDailyData(userId);
        daily.ms += duration;
        daily.sessions.push({ time: new Date().toISOString(), duration, channel: oldState.channel.name });
        delete voiceJoinTimes[userId];
        saveVoiceData();

        if (hasMod) await postStatsTable(MOD_ROLE_ID, CHANNELS.modStats);
        if (hasSupport) await postStatsTable(SUPPORT_ROLE_ID, CHANNELS.supportStats);
      }
    }
  } catch (e) {
    console.error('Voice state error:', e);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    const messageId = reaction.message.id;
    if (!reactionRoleData[messageId]) return;

    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const mapping = reactionRoleData[messageId];
    if (!mapping[emojiKey]) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    await member.roles.add(mapping[emojiKey]).catch(() => {});
  } catch (e) {
    console.error('Reaction role add error:', e);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    if (user.bot) return;
    const messageId = reaction.message.id;
    if (!reactionRoleData[messageId]) return;

    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const mapping = reactionRoleData[messageId];
    if (!mapping[emojiKey]) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    await member.roles.remove(mapping[emojiKey]).catch(() => {});
  } catch (e) {
    console.error('Reaction role remove error:', e);
  }
});

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '🔔'];
const SLOT_WEIGHTS = [25, 25, 20, 15, 8, 5, 2];

function rollSlot() {
  const totalWeight = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
    r -= SLOT_WEIGHTS[i];
    if (r <= 0) return SLOT_SYMBOLS[i];
  }
  return SLOT_SYMBOLS[0];
}

function checkSlotWin(s1, s2, s3) {
  if (s1 === s2 && s2 === s3) {
    if (s1 === '💎') return 10;
    if (s1 === '7️⃣') return 7;
    return 5;
  }
  if (s1 === s2 || s2 === s3 || s1 === s3) return 2;
  return 0;
}

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'ticket') {
        const description = interaction.options.getString('description');
        const ticketNum = nextTicket();
        const embed = new EmbedBuilder()
          .setTitle(`Ticket #${ticketNum}`)
          .setColor(0xf87171)
          .setDescription(`**Question:**\n${description}\n\n**User:**\n${interaction.user} | ${interaction.user.username} | ID: ${interaction.user.id}\n\n**Status:** Open`)
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_claim_${interaction.user.id}_${ticketNum}`).setStyle(ButtonStyle.Primary).setLabel('Claim'),
          new ButtonBuilder().setCustomId(`ticket_close_${interaction.user.id}_${ticketNum}`).setStyle(ButtonStyle.Danger).setLabel('Close')
        );
        const channel = await client.channels.fetch(CHANNELS.reports).catch(() => null);
        if (channel) {
          await channel.send({ content: `<@&${MOD_ROLE_ID}>`, embeds: [embed], components: [row] });
          await interaction.reply({ content: `Ticket #${ticketNum} created. Staff will respond soon.`, ephemeral: true });
        } else {
          await interaction.reply({ content: 'Error: reports channel not found.', ephemeral: true });
        }
      }

      if (commandName === 'voicestats') {
        const targetUser = interaction.options.getUser('user');
        const today = getTodayKey();
        if (targetUser) {
          const data = voiceData[targetUser.id];
          if (!data || !data.daily[today]) {
            await interaction.reply({ content: `No voice data for ${targetUser.username} today.`, ephemeral: true });
            return;
          }
          const daily = data.daily[today];
          const status = daily.ms >= VOICE_NORM_MS ? '✅ Norm met' : '❌ Below norm';
          const embed = new EmbedBuilder()
            .setTitle(`Voice Stats — ${data.username} — ${today}`)
            .setColor(daily.ms >= VOICE_NORM_MS ? 0x4ade80 : 0xf87171)
            .addFields(
              { name: 'Today', value: formatDuration(daily.ms), inline: true },
              { name: 'Status', value: status, inline: true },
              { name: 'Sessions', value: `${daily.sessions.length}`, inline: true }
            )
            .setTimestamp();
          await interaction.reply({ embeds: [embed], ephemeral: true });
        } else {
          const members = await interaction.guild.members.fetch();
          const modMembers = members.filter(m => m.roles.cache.has(MOD_ROLE_ID));
          const supportMembers = members.filter(m => m.roles.cache.has(SUPPORT_ROLE_ID));
          const rows = [];
          for (const [, m] of modMembers) {
            const d = voiceData[m.id];
            const ms = d && d.daily[today] ? d.daily[today].ms : 0;
            rows.push({ name: m.displayName || m.user.username, time: formatDuration(ms), status: ms >= VOICE_NORM_MS ? '✅' : '❌', role: 'Mod' });
          }
          for (const [, m] of supportMembers) {
            const d = voiceData[m.id];
            const ms = d && d.daily[today] ? d.daily[today].ms : 0;
            rows.push({ name: m.displayName || m.user.username, time: formatDuration(ms), status: ms >= VOICE_NORM_MS ? '✅' : '❌', role: 'Support' });
          }
          if (rows.length === 0) {
            await interaction.reply({ content: 'No support or mod members found.', ephemeral: true });
            return;
          }
          const list = rows.map(r => `${r.status} **${r.name}** (${r.role}) — ${r.time}`).join('\n');
          const above = rows.filter(r => r.status === '✅').length;
          const below = rows.filter(r => r.status === '❌').length;
          const embed = new EmbedBuilder()
            .setTitle(`Voice Stats — ${today}`)
            .setColor(0x60a5fa)
            .setDescription(list)
            .addFields(
              { name: 'Above norm (2h+)', value: `${above}`, inline: true },
              { name: 'Below norm', value: `${below}`, inline: true }
            )
            .setTimestamp();
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
      }

      if (commandName === 'coinflip') {
        const bet = interaction.options.getInteger('bet');
        const coin = Math.random() < 0.5 ? 'heads' : 'tails';
        const emoji = coin === 'heads' ? '🪙' : '🌙';

        if (bet) {
          const data = getCurrency(interaction.user.id);
          if (data.coins < bet) {
            await interaction.reply({ content: `You need **${bet}** coins but have only **${data.coins}**.`, ephemeral: true });
            return;
          }
          const won = Math.random() < 0.5;
          if (won) {
            addCoins(interaction.user.id, bet);
          } else {
            addCoins(interaction.user.id, -bet);
          }
          const newBal = getCurrency(interaction.user.id);
          const embed = new EmbedBuilder()
            .setTitle(`${emoji} ${coin.toUpperCase()}!`)
            .setColor(won ? 0x4ade80 : 0xf87171)
            .setDescription(won
              ? `You won **${bet}** coins! (+${bet})\nBalance: **${newBal.coins}** coins`
              : `You lost **${bet}** coins! (-${bet})\nBalance: **${newBal.coins}** coins`)
            .setTimestamp();
          await interaction.reply({ embeds: [embed] });
        } else {
          const embed = new EmbedBuilder()
            .setTitle(`${emoji} ${coin.toUpperCase()}!`)
            .setColor(0x60a5fa)
            .setDescription(`The coin landed on **${coin}**!`)
            .setTimestamp();
          await interaction.reply({ embeds: [embed] });
        }
      }

      if (commandName === 'dice') {
        const sides = interaction.options.getInteger('sides') || 6;
        const result = Math.floor(Math.random() * sides) + 1;
        const bar = '█'.repeat(Math.ceil(result / sides * 10)) + '░'.repeat(10 - Math.ceil(result / sides * 10));
        const embed = new EmbedBuilder()
          .setTitle(`🎲 Dice Roll (1-${sides})`)
          .setColor(0x60a5fa)
          .setDescription(`**${result}**\n\`${bar}\``)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'rps') {
        const userChoice = interaction.options.getString('choice');
        const choices = ['rock', 'paper', 'scissors'];
        const botChoice = choices[Math.floor(Math.random() * 3)];
        const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };

        let result;
        if (userChoice === botChoice) result = 'draw';
        else if ((userChoice === 'rock' && botChoice === 'scissors') || (userChoice === 'paper' && botChoice === 'rock') || (userChoice === 'scissors' && botChoice === 'paper')) result = 'win';
        else result = 'lose';

        const color = result === 'win' ? 0x4ade80 : result === 'draw' ? 0xfbbf24 : 0xf87171;
        const text = result === 'win' ? 'You win!' : result === 'draw' ? "It's a draw!" : 'You lose!';

        const embed = new EmbedBuilder()
          .setTitle('Rock-Paper-Scissors')
          .setColor(color)
          .setDescription(`${emojis[userChoice]} vs ${emojis[botChoice]}\n\n**${text}**`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'daily') {
        const data = getCurrency(interaction.user.id);
        const now = new Date();
        const today = getTodayKey();

        if (data.daily === today) {
          await interaction.reply({ content: 'You already claimed your daily reward today! Come back tomorrow.', ephemeral: true });
          return;
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = yesterday.toISOString().slice(0, 10);

        let streak = data.daily === yesterdayKey ? (data.streak || 0) + 1 : 1;
        const baseReward = 100;
        const streakBonus = Math.min(streak, 7) * 20;
        const totalReward = baseReward + streakBonus;

        data.daily = today;
        data.streak = streak;
        data.coins += totalReward;
        saveCurrencyData();

        const embed = new EmbedBuilder()
          .setTitle('Daily Reward!')
          .setColor(0xfbbf24)
          .setDescription(
            `You received **${totalReward}** coins!\n\n` +
            `Base: ${baseReward} | Streak bonus: +${streakBonus}\n` +
            `Current streak: **${streak}** day${streak > 1 ? 's' : ''}\n\n` +
            `Balance: **${data.coins}** coins`
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'balance') {
        const target = interaction.options.getUser('user') || interaction.user;
        const data = getCurrency(target.id);
        const embed = new EmbedBuilder()
          .setTitle(`Balance — ${target.username}`)
          .setColor(0xfbbf24)
          .setDescription(`**${data.coins}** coins\nStreak: ${data.streak || 0} day(s)`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'leaderboard') {
        const entries = Object.entries(currencyData)
          .map(([id, d]) => ({ id, coins: d.coins || 0, streak: d.streak || 0 }))
          .sort((a, b) => b.coins - a.coins)
          .slice(0, 10);

        if (entries.length === 0) {
          await interaction.reply({ content: 'No one has coins yet!', ephemeral: true });
          return;
        }

        const medals = ['🥇', '🥈', '🥉'];
        const list = entries.map((e, i) => {
          const medal = medals[i] || `**${i + 1}.**`;
          return `${medal} <@${e.id}> — **${e.coins}** coins (streak: ${e.streak})`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('Leaderboard')
          .setColor(0xfbbf24)
          .setDescription(list)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'give') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        if (target.id === interaction.user.id) {
          await interaction.reply({ content: "You can't give coins to yourself!", ephemeral: true });
          return;
        }
        if (target.bot) {
          await interaction.reply({ content: "You can't give coins to a bot!", ephemeral: true });
          return;
        }
        const senderData = getCurrency(interaction.user.id);
        if (senderData.coins < amount) {
          await interaction.reply({ content: `You need **${amount}** coins but have only **${senderData.coins}**.`, ephemeral: true });
          return;
        }
        addCoins(interaction.user.id, -amount);
        addCoins(target.id, amount);
        const embed = new EmbedBuilder()
          .setTitle('Coins Sent!')
          .setColor(0x4ade80)
          .setDescription(`${interaction.user} gave **${amount}** coins to ${target}`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'poll') {
        const question = interaction.options.getString('question');
        const optionsRaw = interaction.options.getString('options').split('|').map(s => s.trim()).filter(Boolean);
        if (optionsRaw.length < 2 || optionsRaw.length > 10) {
          await interaction.reply({ content: 'Provide between 2 and 10 options separated by `|`.', ephemeral: true });
          return;
        }
        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const description = optionsRaw.map((opt, i) => `${numberEmojis[i]} ${opt}`).join('\n');
        const embed = new EmbedBuilder()
          .setTitle(`Poll: ${question}`)
          .setColor(0x60a5fa)
          .setDescription(description)
          .setFooter({ text: `Created by ${interaction.user.username}` })
          .setTimestamp();

        const reply = await interaction.reply({ embeds: [embed], fetchReply: true });
        for (let i = 0; i < optionsRaw.length; i++) {
          await reply.react(numberEmojis[i]).catch(() => {});
        }
      }

      if (commandName === 'giveaway') {
        const prize = interaction.options.getString('prize');
        const duration = interaction.options.getInteger('duration');
        const winners = interaction.options.getInteger('winners') || 1;
        const endAt = Date.now() + duration * 60 * 1000;

        const embed = new EmbedBuilder()
          .setTitle('🎉 Giveaway!')
          .setDescription(
            `**Prize:** ${prize}\n` +
            `**Winners:** ${winners}\n` +
            `**Ends:** <t:${Math.floor(endAt / 1000)}:R>\n\n` +
            `React with 🎉 to enter!`
          )
          .setColor(0xf87171)
          .setFooter({ text: `Started by ${interaction.user.username}` })
          .setTimestamp();

        const reply = await interaction.reply({ embeds: [embed], fetchReply: true });
        await reply.react('🎉').catch(() => {});

        giveawayData.active.push({
          messageId: reply.id,
          channelId: interaction.channel.id,
          guildId: interaction.guild.id,
          prize,
          winners,
          endAt,
          startedBy: interaction.user.id
        });
        saveGiveawayData();

        setTimeout(async () => {
          try {
            const channel = await client.channels.fetch(giveawayData.active.find(g => g.messageId === reply.id)?.channelId).catch(() => null);
            if (!channel) return;
            const msg = await channel.messages.fetch(reply.id).catch(() => null);
            if (!msg) return;

            const reaction = msg.reactions.cache.get('🎉');
            if (!reaction) {
              const noEntryEmbed = EmbedBuilder.from(msg.embeds[0]).setDescription('No participants. Giveaway cancelled.').setColor(0x9ca3af);
              await msg.edit({ embeds: [noEntryEmbed] });
              giveawayData.active = giveawayData.active.filter(g => g.messageId !== reply.id);
              giveawayData.ended.push({ messageId: reply.id, prize, winners: 0, participants: 0 });
              saveGiveawayData();
              return;
            }

            const users = await reaction.users.fetch();
            const participants = users.filter(u => !u.bot).map(u => u.id);

            if (participants.length === 0) {
              const noEntryEmbed = EmbedBuilder.from(msg.embeds[0]).setDescription('No participants. Giveaway cancelled.').setColor(0x9ca3af);
              await msg.edit({ embeds: [noEntryEmbed] });
              giveawayData.active = giveawayData.active.filter(g => g.messageId !== reply.id);
              giveawayData.ended.push({ messageId: reply.id, prize, winners: 0, participants: 0 });
              saveGiveawayData();
              return;
            }

            const shuffled = participants.sort(() => Math.random() - 0.5);
            const winnerIds = shuffled.slice(0, Math.min(winners, shuffled.length));
            const winnerMentions = winnerIds.map(id => `<@${id}>`).join(', ');

            const winEmbed = EmbedBuilder.from(msg.embeds[0])
              .setDescription(
                `**Prize:** ${prize}\n` +
                `**Winner(s):** ${winnerMentions}\n\n` +
                `Congratulations! 🎉`
              )
              .setColor(0x4ade80)
              .setTimestamp();

            await msg.edit({ embeds: [winEmbed] });
            await channel.send({ content: `Congratulations ${winnerMentions}! You won **${prize}**! 🎉` });

            giveawayData.active = giveawayData.active.filter(g => g.messageId !== reply.id);
            giveawayData.ended.push({ messageId: reply.id, prize, winners: winnerIds.length, participants: participants.length });
            saveGiveawayData();
          } catch (e) {
            console.error('Giveaway end error:', e);
          }
        }, duration * 60 * 1000);
      }

      if (commandName === '8ball') {
        const question = interaction.options.getString('question');
        const answers = [
          'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes — definitely.',
          'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
          'Yes.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
          'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
          "Don't count on it.", 'My reply is no.', 'My sources say no.',
          'Outlook not so good.', 'Very doubtful.'
        ];
        const answer = answers[Math.floor(Math.random() * answers.length)];
        const embed = new EmbedBuilder()
          .setTitle('🎱 Magic 8-Ball')
          .setColor(0x60a5fa)
          .addFields(
            { name: 'Question', value: question },
            { name: 'Answer', value: answer }
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'slots') {
        const bet = interaction.options.getInteger('bet');
        const data = getCurrency(interaction.user.id);
        if (data.coins < bet) {
          await interaction.reply({ content: `You need **${bet}** coins but have only **${data.coins}**.`, ephemeral: true });
          return;
        }

        const s1 = rollSlot(), s2 = rollSlot(), s3 = rollSlot();
        const multiplier = checkSlotWin(s1, s2, s3);
        const winAmount = bet * multiplier;

        if (multiplier > 0) addCoins(interaction.user.id, winAmount - bet);
        else addCoins(interaction.user.id, -bet);

        const newBal = getCurrency(interaction.user.id);
        const resultText = multiplier > 0 ? `You won **${winAmount}** coins!` : 'You lost!';
        const color = multiplier >= 5 ? 0xfbbf24 : multiplier >= 2 ? 0x4ade80 : 0xf87171;

        const embed = new EmbedBuilder()
          .setTitle('🎰 Slot Machine')
          .setColor(color)
          .setDescription(
            `[ ${s1} | ${s2} | ${s3} ]\n\n` +
            `${resultText}\n` +
            `Balance: **${newBal.coins}** coins`
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'shop') {
        const items = [
          { name: 'Custom Role Color', price: 500, emoji: '🎨' },
          { name: 'VIP Badge', price: 1000, emoji: '👑' },
          { name: 'Custom Nickname', price: 200, emoji: '✏️' },
          { name: 'Double Daily (1 week)', price: 1500, emoji: '💰' },
          { name: 'Mystery Box', price: 300, emoji: '🎁' }
        ];
        const list = items.map(i => `${i.emoji} **${i.name}** — ${i.price} coins`).join('\n');
        const embed = new EmbedBuilder()
          .setTitle('Shop')
          .setColor(0xfbbf24)
          .setDescription(list)
          .setFooter({ text: 'Use /buy <item name> to purchase' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'buy') {
        const item = interaction.options.getString('item').toLowerCase();
        const data = getCurrency(interaction.user.id);
        const items = {
          'custom role color': { price: 500, emoji: '🎨' },
          'custom role': { price: 500, emoji: '🎨' },
          'color': { price: 500, emoji: '🎨' },
          'vip badge': { price: 1000, emoji: '👑' },
          'vip': { price: 1000, emoji: '👑' },
          'custom nickname': { price: 200, emoji: '✏️' },
          'nickname': { price: 200, emoji: '✏️' },
          'double daily': { price: 1500, emoji: '💰' },
          'mystery box': { price: 300, emoji: '🎁' },
          'box': { price: 300, emoji: '🎁' }
        };

        const found = items[item];
        if (!found) {
          await interaction.reply({ content: 'Item not found. Use `/shop` to see available items.', ephemeral: true });
          return;
        }
        if (data.coins < found.price) {
          await interaction.reply({ content: `You need **${found.price}** coins but have only **${data.coins}**.`, ephemeral: true });
          return;
        }

        addCoins(interaction.user.id, -found.price);

        let bonusText = '';
        if (item === 'mystery box' || item === 'box') {
          const bonus = Math.floor(Math.random() * 500) + 50;
          addCoins(interaction.user.id, bonus);
          bonusText = `\nInside the box you found **${bonus}** coins!`;
        }

        const embed = new EmbedBuilder()
          .setTitle('Purchase Complete!')
          .setColor(0x4ade80)
          .setDescription(`You bought **${found.emoji} ${item}** for **${found.price}** coins!${bonusText}\nBalance: **${getCurrency(interaction.user.id).coins}** coins`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'setreactionrole') {
        const messageId = interaction.options.getString('messageid');
        const rolesStr = interaction.options.getString('roles');
        const pairs = rolesStr.split(',').map(s => s.trim()).filter(Boolean);
        const mapping = {};

        for (const pair of pairs) {
          const [emoji, roleId] = pair.split(':').map(s => s.trim());
          if (emoji && roleId) {
            mapping[emoji] = roleId;
          }
        }

        if (Object.keys(mapping).length === 0) {
          await interaction.reply({ content: 'No valid emoji:roleId pairs found. Format: `emoji:roleId,emoji:roleId`', ephemeral: true });
          return;
        }

        reactionRoleData[messageId] = mapping;
        saveReactionRoleData();

        const msg = await interaction.channel.messages.fetch(messageId).catch(() => null);
        if (msg) {
          for (const emoji of Object.keys(mapping)) {
            await msg.react(emoji).catch(() => {});
          }
        }

        const embed = new EmbedBuilder()
          .setTitle('Reaction Roles Set!')
          .setColor(0x4ade80)
          .setDescription(`Added ${Object.keys(mapping).length} reaction role(s) to message ${messageId}`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'welcome') {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const colorHex = interaction.options.getString('color') || '#60a5fa';
        const color = parseInt(colorHex.replace('#', ''), 16) || 0x60a5fa;

        const channel = await client.channels.fetch(CHANNELS.welcome).catch(() => null);
        if (!channel) {
          await interaction.reply({ content: 'Welcome channel not found.', ephemeral: true });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setColor(color)
          .setTimestamp();

        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: 'Welcome embed sent!', ephemeral: true });
      }

      return;
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('ticket_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1];
      const userId = parts[2];
      const ticketNum = parts[3];

      if (action === 'claim') {
        await interaction.deferUpdate();
        const guild = interaction.guild;
        const category = guild.channels.cache.find(c => c.name.toLowerCase() === 'tickets' && c.type === 4);
        const ticketChannel = await guild.channels.create({
          name: `ticket-${ticketNum}`,
          type: 0,
          parent: category ? category.id : null,
          permissionOverwrites: [
            { id: guild.id, deny: ['ViewChannel'] },
            { id: userId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
          ]
        });
        const helpRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_help_${userId}_${ticketNum}`).setStyle(ButtonStyle.Secondary).setLabel('Request Help'),
          new ButtonBuilder().setCustomId(`ticket_close_${userId}_${ticketNum}`).setStyle(ButtonStyle.Danger).setLabel('Close')
        );
        await ticketChannel.send({ content: `<@${userId}> Welcome to your support ticket. A staff member will assist you shortly.`, components: [helpRow] });
        const updatedRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
          ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
        );
        await interaction.message.edit({ components: [updatedRow] });
        const old = interaction.message.embeds[0];
        const newDesc = old.description.replace(/\*\*Status:\*\* Open/, `**Status:** Claimed\n**Agent:** ${interaction.user.username}\n**Channel:** <#${ticketChannel.id}>`);
        const embed_ = EmbedBuilder.from(old).setDescription(newDesc).setColor(0x4ade80);
        await interaction.message.edit({ embeds: [embed_] });
        await interaction.followUp({ content: `Ticket #${ticketNum} claimed. Channel ${ticketChannel} created.`, ephemeral: true });
      }

      if (action === 'close') {
        await interaction.deferUpdate();
        const ticketChannel = interaction.guild.channels.cache.find(c => c.name === `ticket-${ticketNum}`);
        const old = interaction.message.embeds[0];
        if (old) {
          const newDesc = old.description.replace(/\*\*Status:\*\* Open/, '**Status:** Closed').replace(/\*\*Status:\*\* Claimed/, '**Status:** Closed');
          const embed_ = EmbedBuilder.from(old).setDescription(newDesc).setColor(0x9ca3af);
          const updatedRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
            ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
          );
          await interaction.message.edit({ components: [updatedRow], embeds: [embed_] });
        } else {
          const updatedRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
            ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
          );
          await interaction.message.edit({ components: [updatedRow] });
        }
        if (ticketChannel) {
          await ticketChannel.send({ content: 'This ticket has been closed by a staff member.' });
          setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
        }
        await interaction.followUp({ content: `Ticket #${ticketNum} closed.`, ephemeral: true });
      }

      if (action === 'help') {
        await interaction.deferUpdate();
        const ticketChannel = interaction.guild.channels.cache.find(c => c.name === `ticket-${ticketNum}`);
        if (ticketChannel) {
          await ticketChannel.permissionOverwrites.create(SUPPORT_ROLE_ID, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
          await ticketChannel.send({ content: `<@&${SUPPORT_ROLE_ID}> Help has been requested in this ticket.` });
          const updatedRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
            ButtonBuilder.from(interaction.message.components[0].components[1])
          );
          await interaction.message.edit({ components: [updatedRow] });
          await interaction.followUp({ content: `Support role now has access to ticket #${ticketNum}.`, ephemeral: true });
        } else {
          await interaction.channel.send({ content: `<@&${SUPPORT_ROLE_ID}> Help has been requested for Ticket #${ticketNum}. Please claim this ticket to assist.` });
          const updatedRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
            ButtonBuilder.from(interaction.message.components[0].components[1])
          );
          await interaction.message.edit({ components: [updatedRow] });
          await interaction.followUp({ content: `Support role has been notified for Ticket #${ticketNum}.`, ephemeral: true });
        }
      }
      return;
    }

    if (interaction.customId.startsWith('vac_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1];
      const discordName = parts[2];
      await interaction.deferUpdate();
      const old = interaction.message.embeds[0];

      if (action === 'accept') {
        const embed_ = EmbedBuilder.from(old).setColor(0x4ade80).setFooter({ text: `Принято: ${interaction.user.username}` }).setTimestamp();
        await interaction.message.edit({ embeds: [embed_] });
        const updatedRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
          ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
        );
        await interaction.message.edit({ components: [updatedRow] });
        const member = await findUserByDiscord(discordName, interaction.guild);
        if (member) {
          const dmEmbed = new EmbedBuilder().setColor(0x4ade80).setTitle('Заявка на отпуск').setDescription('Ваша заявка на отпуск **принята**.\n\nАдминистратор одобрил ваш отпуск. Приятного отдыха!').setTimestamp();
          await sendDM(member.user.id, dmEmbed);
        }
        await interaction.followUp({ content: `Заявка на отпуск от **${discordName}** принята.`, ephemeral: true });
      }

      if (action === 'reject') {
        const embed_ = EmbedBuilder.from(old).setColor(0x9ca3af).setFooter({ text: `Отклонено: ${interaction.user.username}` }).setTimestamp();
        await interaction.message.edit({ embeds: [embed_] });
        const updatedRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
          ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
        );
        await interaction.message.edit({ components: [updatedRow] });
        const member = await findUserByDiscord(discordName, interaction.guild);
        if (member) {
          const dmEmbed = new EmbedBuilder().setColor(0xf87171).setTitle('Заявка на отпуск').setDescription('Ваша заявка на отпуск **отклонена**.\n\nАдминистратор отклонил вашу заявку. Если есть вопросы — обратитесь к администрации.').setTimestamp();
          await sendDM(member.user.id, dmEmbed);
        }
        await interaction.followUp({ content: `Заявка на отпуск от **${discordName}** отклонена.`, ephemeral: true });
      }
      return;
    }

    const parts = interaction.customId.split('_');
    const action = parts[0] === 'a' ? 'accept' : 'reject';
    const role = parts[1];
    const discordName = parts.slice(2, -1).join('_');
    await interaction.deferUpdate();
    const adminName = `<@${interaction.user.id}>`;
    const adminTag = interaction.user.tag;
    const roleName = ROLE_NAMES[role] || role;

    const updatedRow = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
      ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
    );
    await interaction.message.edit({ components: [updatedRow] });

    if (action === 'accept') {
      const acceptText =
        `**Your application for ${roleName} has been accepted!**\n\n` +
        `**Accepted by:** ${adminName}\n\n` +
        `**Server:** ${INVITE}\n` +
        `After joining, go to voice channel for verification.\n\n` +
        `After verification you will get access to study materials.`;
      const embed = new EmbedBuilder().setColor(0x4ade80).setDescription(acceptText).setFooter({ text: `Accepted by: ${adminTag}` }).setTimestamp();
      const member = await findUserByDiscord(discordName, interaction.guild);
      if (member) {
        const sent = await sendDM(member.user.id, embed);
        await interaction.followUp({ content: sent ? `Notification sent to **${discordName}**` : `Could not send DM to **${discordName}** (DMs closed)`, ephemeral: true });
      } else {
        await interaction.followUp({ content: `User **${discordName}** not found on server.`, ephemeral: true });
      }
    } else if (action === 'reject') {
      const rejectText =
        `**Your application for ${roleName} has been rejected.**\n\n` +
        `Thank you for your interest, but we decided to go with another candidate.`;
      const embed = new EmbedBuilder().setColor(0xf87171).setDescription(rejectText).setFooter({ text: `Rejected by: ${adminTag}` }).setTimestamp();
      const member = await findUserByDiscord(discordName, interaction.guild);
      if (member) {
        const sent = await sendDM(member.user.id, embed);
        await interaction.followUp({ content: sent ? `Notification sent to **${discordName}**` : `Could not send DM to **${discordName}**`, ephemeral: true });
      } else {
        await interaction.followUp({ content: `User **${discordName}** not found.`, ephemeral: true });
      }
    }
  } catch (e) {
    console.error('Interaction error:', e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP server on port ${PORT}`));

client.login(TOKEN).catch(err => {
  console.error('Discord login error:', err.message);
});
