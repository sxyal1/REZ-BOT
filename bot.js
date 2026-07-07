import { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import express from 'express';
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
  console.log(`Бот запущен как ${client.user.tag}`);
  console.log(`Сервер: ${GUILD_ID}`);
  console.log(`Ожидание заявок...`);

  const commands = [
    new SlashCommandBuilder()
      .setName('жалоба')
      .setDescription('Пожаловаться на пользователя')
      .addUserOption(o => o.setName('на_кого').setDescription('На кого жалоба').setRequired(true))
      .addStringOption(o => o.setName('причина').setDescription('Причина жалобы').setRequired(true))
      .addStringOption(o => o.setName('доказательства').setDescription('Ссылка на доказательства (скриншоты и т.д.)').setRequired(false))
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Слеш-команды зарегистрированы');
  } catch (e) {
    console.error('Ошибка регистрации команд:', e.message);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'жалоба') {
      const target = interaction.options.getUser('на_кого');
      const reason = interaction.options.getString('причина');
      const evidence = interaction.options.getString('доказательства');

      const embed = new EmbedBuilder()
        .setTitle('⚠️ Новая жалоба')
        .setColor(0xf87171)
        .addFields(
          { name: 'Отправитель', value: `${interaction.user} (${interaction.user.id})`, inline: false },
          { name: 'На кого', value: `${target} (${target.id})`, inline: false },
          { name: 'Причина', value: reason, inline: false }
        )
        .setTimestamp();

      if (evidence) embed.addFields({ name: 'Доказательства', value: evidence, inline: false });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rep_review_${interaction.user.id}_${target.id}_${Date.now()}`)
          .setStyle(ButtonStyle.Primary)
          .setLabel('Рассмотрено')
      );

      const channel = await client.channels.fetch(CHANNELS.reports).catch(() => null);
      if (channel) {
        await channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: '✅ Ваша жалоба отправлена на рассмотрение саппортам.', ephemeral: true });
      } else {
        await interaction.reply({ content: '❌ Ошибка: канал для жалоб не найден.', ephemeral: true });
      }
    }
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith('rep_')) {
    if (interaction.customId.startsWith('rep_review_')) {
      await interaction.deferUpdate();

      const updatedRow = new ActionRowBuilder().addComponents(
        ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true)
      );
      await interaction.message.edit({ components: [updatedRow] });

      const embed_ = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x4ade80)
        .addFields({ name: 'Статус', value: `✅ Рассмотрено — <@${interaction.user.id}>` });

      await interaction.message.edit({ embeds: [embed_] });
      await interaction.followUp({ content: '✅ Жалоба отмечена как рассмотренная.', ephemeral: true });
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
      `✅ **Ваша заявка на ${roleName} принята!**\n\n` +
      `**Принял:** ${adminName}\n\n` +
      `**Сервер:** ${INVITE}\n` +
      `После входа зайдите в голосовой канал **〔🔊〕𝔾𝕖𝕟𝕖𝕣𝕒𝕝** для прохождения проверки.\n\n` +
      `После проверки вам откроются материалы для изучения.`;

    const embed = new EmbedBuilder()
      .setColor(0x4ade80)
      .setDescription(acceptText)
      .setFooter({ text: `Принял: ${adminTag}` })
      .setTimestamp();

    const member = await findUserByDiscord(discordName, interaction.guild);
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
      .setColor(0xf87171)
      .setDescription(rejectText)
      .setFooter({ text: `Отклонил: ${adminTag}` })
      .setTimestamp();

    const member = await findUserByDiscord(discordName, interaction.guild);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP сервер на порту ${PORT}`));

client.login(TOKEN).catch(err => {
  console.error('Discord login error:', err.message);
});
