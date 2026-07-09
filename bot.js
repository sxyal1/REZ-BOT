import { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
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
  moderator: process.env.CH_MOD || '1480141289872687154',
  support: process.env.CH_SUPPORT || '1523738675186499665',
  curator: process.env.CH_CURATOR || '1523738807533437128',
  reports: '1524186097180086355',
  supportStats: '1524198456607117332',
  modStats: '1523152195523186739',
  vacation: '1524846250854318140'
};

const ROLE_NAMES = {
  moderator: 'Модератор',
  support: 'Сапорт',
  curator: 'Ассистент куратора'
};

const MOD_ROLE_ID = '1442598138761314376';
const SUPPORT_ROLE_ID = '1524203277863096411';
const TICKET_FILE = join(__dirname, 'ticket_counter.json');
const VOICE_FILE = join(__dirname, 'voice_time.json');

let ticketCounter = 1;
if (existsSync(TICKET_FILE)) {
  try { ticketCounter = JSON.parse(readFileSync(TICKET_FILE, 'utf8')).count || 1; } catch {}
}

function nextTicket() {
  const n = ticketCounter++;
  writeFileSync(TICKET_FILE, JSON.stringify({ count: ticketCounter }));
  return n;
}

let voiceData = {};
if (existsSync(VOICE_FILE)) {
  try { voiceData = JSON.parse(readFileSync(VOICE_FILE, 'utf8')); } catch {}
}

function saveVoiceData() {
  writeFileSync(VOICE_FILE, JSON.stringify(voiceData, null, 2));
}

const voiceJoinTimes = {};
const VOICE_NORM_MS = 2 * 60 * 60 * 1000;

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return `${hours}h ${minutes}m`;
}

function getDailyData(userId) {
  const today = getTodayKey();
  if (!voiceData[userId]) {
    voiceData[userId] = { username: '', daily: {} };
  }
  if (!voiceData[userId].daily[today]) {
    voiceData[userId].daily[today] = { ms: 0, sessions: [] };
  }
  return voiceData[userId].daily[today];
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
    if (data && data.daily[today]) {
      dailyMs = data.daily[today].ms;
    }
    const status = dailyMs >= VOICE_NORM_MS ? '✅' : '❌';
    rows.push({
      name: member.displayName || member.user.username,
      time: formatDuration(dailyMs),
      status
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  const description = rows.map(r =>
    `${r.status} **${r.name}** — ${r.time}`
  ).join('\n');

  const totalMs = rows.reduce((sum, r) => {
    const d = voiceData[Object.keys(voiceData).find(k => {
      const m = roleMembers.find(u => u.id === k);
      return m && (m.displayName || m.user.username) === r.name;
    })];
    return sum + (d && d.daily[today] ? d.daily[today].ms : 0);
  }, 0);

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
    const found = g.members.cache.find(m => {
      const uname = (m.user.username || '').toLowerCase();
      const gname = (m.nick || m.user.global_name || '').toLowerCase();
      return uname === raw || gname === raw ||
             uname.replace(/[^a-z0-9]/g, '') === clean ||
             gname.replace(/[^a-z0-9]/g, '') === clean ||
             uname.startsWith(raw) || gname.startsWith(raw);
    });
    return found || null;
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
    if (!role || !name || !discord) {
      return res.json({ ok: false, error: 'Заполните имя и Discord' });
    }

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
      new ButtonBuilder()
        .setCustomId(`a_${role}_${safeTag}_${timestamp}`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`r_${role}_${safeTag}_${timestamp}`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌')
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
    if (!discord || !dateFrom || !dateTo) {
      return res.json({ ok: false, error: 'Заполните все обязательные поля' });
    }

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
      new ButtonBuilder()
        .setCustomId(`vac_accept_${discord.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now()}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('Принять'),
      new ButtonBuilder()
        .setCustomId(`vac_reject_${discord.replace(/[^a-zA-Z0-9_]/g, '')}_${Date.now()}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Отклонить')
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
      result.mods.push({
        username: m.displayName || m.user.username,
        avatar: m.user.displayAvatarURL({ dynamic: true }),
        timeMs: ms,
        sessions: d && d.daily[today] ? d.daily[today].sessions.length : 0
      });
    }

    for (const [, m] of supportMembers) {
      const d = voiceData[m.id];
      const ms = d && d.daily[today] ? d.daily[today].ms : 0;
      result.support.push({
        username: m.displayName || m.user.username,
        avatar: m.user.displayAvatarURL({ dynamic: true }),
        timeMs: ms,
        sessions: d && d.daily[today] ? d.daily[today].sessions.length : 0
      });
    }

    result.mods.sort((a, b) => b.timeMs - a.timeMs);
    result.support.sort((a, b) => b.timeMs - a.timeMs);

    res.json(result);
  } catch (e) {
    console.error('/api/voice error:', e);
    res.json({ mods: [], support: [], date: getTodayKey() });
  }
});

client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
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
      .addUserOption(o => o.setName('user').setDescription('Check specific user (optional)').setRequired(false))
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Slash commands registered');
  } catch (e) {
    console.error('Command registration error:', e.message);
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

    if (!voiceData[userId]) {
      voiceData[userId] = { username: member.user.username, daily: {} };
    }
    voiceData[userId].username = member.user.username;

    const wasInVoice = !!oldState.channelId;
    const isInVoice = !!newState.channelId;

    if (!wasInVoice && isInVoice) {
      voiceJoinTimes[userId] = Date.now();
    }

    if (wasInVoice && !isInVoice) {
      const joinTime = voiceJoinTimes[userId];
      if (joinTime) {
        const duration = Date.now() - joinTime;
        const daily = getDailyData(userId);
        daily.ms += duration;
        daily.sessions.push({
          time: new Date().toISOString(),
          duration,
          channel: oldState.channel.name
        });
        delete voiceJoinTimes[userId];
        saveVoiceData();

        if (hasMod) {
          await postStatsTable(MOD_ROLE_ID, CHANNELS.modStats);
        }
        if (hasSupport) {
          await postStatsTable(SUPPORT_ROLE_ID, CHANNELS.supportStats);
        }
      }
    }
  } catch (e) {
    console.error('Voice state error:', e);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'ticket') {
        const description = interaction.options.getString('description');
        const ticketNum = nextTicket();

        const embed = new EmbedBuilder()
          .setTitle(`Ticket #${ticketNum}`)
          .setColor(0xf87171)
          .setDescription(
            `**Question:**\n${description}\n\n` +
            `**User:**\n${interaction.user} | ${interaction.user.username} | ID: ${interaction.user.id}\n\n` +
            `**Status:** Open`
          )
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_claim_${interaction.user.id}_${ticketNum}`)
            .setStyle(ButtonStyle.Primary)
            .setLabel('Claim'),
          new ButtonBuilder()
            .setCustomId(`ticket_close_${interaction.user.id}_${ticketNum}`)
            .setStyle(ButtonStyle.Danger)
            .setLabel('Close')
        );

        const channel = await client.channels.fetch(CHANNELS.reports).catch(() => null);
        if (channel) {
          await channel.send({ content: `<@&${MOD_ROLE_ID}>`, embeds: [embed], components: [row] });
          await interaction.reply({ content: `Ticket #${ticketNum} created. Staff will respond soon.`, ephemeral: true });
        } else {
          await interaction.reply({ content: 'Error: reports channel not found.', ephemeral: true });
        }
      }

      if (interaction.commandName === 'voicestats') {
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
          new ButtonBuilder()
            .setCustomId(`ticket_help_${userId}_${ticketNum}`)
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Request Help'),
          new ButtonBuilder()
            .setCustomId(`ticket_close_${userId}_${ticketNum}`)
            .setStyle(ButtonStyle.Danger)
            .setLabel('Close')
        );

        await ticketChannel.send({
          content: `<@${userId}> Welcome to your support ticket. A staff member will assist you shortly.`,
          components: [helpRow]
        });

        const updatedRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
          ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
        );
        await interaction.message.edit({ components: [updatedRow] });

        const old = interaction.message.embeds[0];
        const newDesc = old.description
          .replace(/\*\*Status:\*\* Open/, `**Status:** Claimed\n**Agent:** ${interaction.user.username}\n**Channel:** <#${ticketChannel.id}>`);

        const embed_ = EmbedBuilder.from(old)
          .setDescription(newDesc)
          .setColor(0x4ade80);

        await interaction.message.edit({ embeds: [embed_] });
        await interaction.followUp({ content: `Ticket #${ticketNum} claimed. Channel ${ticketChannel} created.`, ephemeral: true });
      }

      if (action === 'close') {
        await interaction.deferUpdate();

        const ticketChannel = interaction.guild.channels.cache.find(c => c.name === `ticket-${ticketNum}`);

        const old = interaction.message.embeds[0];
        if (old) {
          const newDesc = old.description
            .replace(/\*\*Status:\*\* Open/, '**Status:** Closed')
            .replace(/\*\*Status:\*\* Claimed/, '**Status:** Closed');

          const embed_ = EmbedBuilder.from(old)
            .setDescription(newDesc)
            .setColor(0x9ca3af);

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
          await ticketChannel.permissionOverwrites.create(SUPPORT_ROLE_ID, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });

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

          await interaction.followUp({ content: `Support role has been notified for ticket #${ticketNum}.`, ephemeral: true });
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
        const embed_ = EmbedBuilder.from(old)
          .setColor(0x4ade80)
          .setFooter({ text: `Принято: ${interaction.user.username}` })
          .setTimestamp();

        await interaction.message.edit({ embeds: [embed_] });

        const updatedRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
          ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
        );
        await interaction.message.edit({ components: [updatedRow] });

        await interaction.followUp({ content: `Заявка на отпуск от **${discordName}** принята.`, ephemeral: true });
      }

      if (action === 'reject') {
        const embed_ = EmbedBuilder.from(old)
          .setColor(0x9ca3af)
          .setFooter({ text: `Отклонено: ${interaction.user.username}` })
          .setTimestamp();

        await interaction.message.edit({ embeds: [embed_] });

        const updatedRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
          ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
        );
        await interaction.message.edit({ components: [updatedRow] });

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

      const embed = new EmbedBuilder()
        .setColor(0x4ade80)
        .setDescription(acceptText)
        .setFooter({ text: `Accepted by: ${adminTag}` })
        .setTimestamp();

      const member = await findUserByDiscord(discordName, interaction.guild);
      if (member) {
        const sent = await sendDM(member.user.id, embed);
        await interaction.followUp({
          content: sent
            ? `Notification sent to **${discordName}**`
            : `Could not send DM to **${discordName}** (DMs closed)`,
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          content: `User **${discordName}** not found on server.`,
          ephemeral: true
        });
      }
    } else if (action === 'reject') {
      const rejectText =
        `**Your application for ${roleName} has been rejected.**\n\n` +
        `Thank you for your interest, but we decided to go with another candidate.`;

      const embed = new EmbedBuilder()
        .setColor(0xf87171)
        .setDescription(rejectText)
        .setFooter({ text: `Rejected by: ${adminTag}` })
        .setTimestamp();

      const member = await findUserByDiscord(discordName, interaction.guild);
      if (member) {
        const sent = await sendDM(member.user.id, embed);
        await interaction.followUp({
          content: sent
            ? `Notification sent to **${discordName}**`
            : `Could not send DM to **${discordName}**`,
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          content: `User **${discordName}** not found.`,
          ephemeral: true
        });
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
