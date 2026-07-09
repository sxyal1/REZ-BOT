import { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const TOKEN = process.env.DISCORD_TOKEN || 'MTUyMzc2NTM5MzY4Mjg1ODA0OA.GE8PTn.kcYvGggU1x7PKo-HDTuhqAowwDfuDkThX9j-Us';
const GUILD_ID = process.env.GUILD_ID || '1442592660853625038';
const INVITE = process.env.INVITE_URL || 'https://discord.gg/uSSGpABkMT';

const CHANNELS = {
  moderator: process.env.CH_MOD || '1480141289872687154',
  support: process.env.CH_SUPPORT || '1523738675186499665',
  curator: process.env.CH_CURATOR || '1523738807533437128',
  reports: '1524186097180086355'
};

const ROLE_NAMES = {
  moderator: 'Модератор',
  support: 'Сапорт',
  curator: 'Ассистент куратора'
};

const MOD_ROLE_ID = '1442598138761314376';
const TICKET_FILE = 'ticket_counter.json';

let ticketCounter = 1;
if (existsSync(TICKET_FILE)) {
  try { ticketCounter = JSON.parse(readFileSync(TICKET_FILE, 'utf8')).count || 1; } catch {}
}

function nextTicket() {
  const n = ticketCounter++;
  writeFileSync(TICKET_FILE, JSON.stringify({ count: ticketCounter }));
  return n;
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

client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers]
});

client.once('ready', async () => {
  console.log(`Bot started as ${client.user.tag}`);
  console.log(`Guild: ${GUILD_ID}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Create a support ticket')
      .addStringOption(o => o.setName('description').setDescription('Describe your issue or question').setRequired(true))
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Slash commands registered');
  } catch (e) {
    console.error('Command registration error:', e.message);
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
            { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            { id: MOD_ROLE_ID, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
          ]
        });

        await ticketChannel.send({ content: `<@${userId}> Welcome to your support ticket. A staff member will assist you shortly.` });

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

        const old = interaction.message.embeds[0];
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

        const ticketChannel = interaction.guild.channels.cache.find(c => c.name === `ticket-${ticketNum}`);
        if (ticketChannel) {
          await ticketChannel.send({ content: 'This ticket has been closed by a staff member.' });
          setTimeout(() => ticketChannel.delete().catch(() => {}), 5000);
        }

        await interaction.followUp({ content: `Ticket #${ticketNum} closed.`, ephemeral: true });
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
