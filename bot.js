import { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import express from 'express';
const TOKEN = process.env.DISCORD_TOKEN || 'MTUyMzc2NTM5MzY4Mjg1ODA0OA.GE8PTn.kcYvGggU1x7PKo-HDTuhqAowwDfuDkThX9j-Us';
const GUILD_ID = process.env.GUILD_ID || '1442592660853625038';
const INVITE = process.env.INVITE_URL || 'https://discord.gg/uSSGpABkMT';

const CHANNELS = {
  moderator: process.env.CH_MOD || '1480141289872687154',
  support: process.env.CH_SUPPORT || '1523738675186499665',
  curator: process.env.CH_CURATOR || '1523738807533437128'
};

const ROLE_NAMES = {
  moderator: 'Модератор',
  support: 'Сапорт',
  curator: 'Ассистент куратора'
};

let client;
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function findUserByDiscord(discordName) {
  try {
    const name = discordName.toLowerCase().replace(/#\d+$/, '').trim();
    let members = await rest.get(Routes.guildMembers(GUILD_ID), { query: { limit: 1000 } });
    return members.find(m => {
      const uname = (m.user.username || '').toLowerCase();
      const gname = (m.nick || m.user.global_name || '').toLowerCase();
      return uname === name || gname === name || uname.startsWith(name) || gname.startsWith(name);
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

    const safeTag = discord.replace(/[^a-zA-Z0-9_#\s]/g, '').trim().substring(0, 32);
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

client.once('ready', () => {
  console.log(`Бот запущен как ${client.user.tag}`);
  console.log(`Сервер: ${GUILD_ID}`);
  console.log(`Ожидание заявок...`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split('_');
  const action = parts[0] === 'a' ? 'accept' : 'reject';
  const role = parts[1];
  const discordName = parts.slice(2, -1).join('_');

  await interaction.deferUpdate();

  const adminName = interaction.user.tag;
  const roleName = ROLE_NAMES[role] || role;

  const updatedRow = new ActionRowBuilder().addComponents(
    ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
    ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
  );
  await interaction.message.edit({ components: [updatedRow] });

  if (action === 'accept') {
    const acceptText =
      `✅ **Ваша заявка на ${roleName} принята!**\n\n` +
      `**Принял:** ${adminName}\n\n` +
      `**Сервер:** ${INVITE}\n` +
      `После входа зайдите в голосовой канал **〔🔊〕𝔾𝕖𝕟𝕖𝕣𝕒𝕝** для прохождения проверки.\n\n` +
      `После проверки вам откроются материалы для изучения.`;

    const embed = new EmbedBuilder()
      .setTitle('✅ Заявка принята')
      .setColor(0x4ade80)
      .setDescription(acceptText)
      .setFooter({ text: `Принял: ${adminName}` })
      .setTimestamp();

    const member = await findUserByDiscord(discordName);
    if (member) {
      const sent = await sendDM(member.user.id, embed);
      await interaction.followUp({
        content: sent
          ? `✅ Уведомление отправлено **${discordName}**`
          : `⚠️ Не удалось отправить DM **${discordName}** (закрыты сообщения)`,
        ephemeral: true
      });
    } else {
      await interaction.followUp({
        content: `⚠️ Пользователь **${discordName}** не найден на сервере. Отправьте приглашение вручную.`,
        ephemeral: true
      });
    }
  } else if (action === 'reject') {
    const rejectText =
      `❌ **Ваша заявка на ${roleName} отклонена.**\n\n` +
      `Спасибо за интерес, но мы решили выбрать другого кандидата.`;

    const embed = new EmbedBuilder()
      .setTitle('❌ Заявка отклонена')
      .setColor(0xf87171)
      .setDescription(rejectText)
      .setFooter({ text: `Отклонил: ${adminName}` })
      .setTimestamp();

    const member = await findUserByDiscord(discordName);
    if (member) {
      const sent = await sendDM(member.user.id, embed);
      await interaction.followUp({
        content: sent
          ? `✅ Уведомление отправлено **${discordName}**`
          : `⚠️ Не удалось отправить DM **${discordName}**`,
        ephemeral: true
      });
    } else {
      await interaction.followUp({
        content: `⚠️ Пользователь **${discordName}** не найден. Отказ отправлен, но DM не доставлен.`,
        ephemeral: true
      });
    }
  }
});

client.login(TOKEN);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP сервер на порту ${PORT}`));
