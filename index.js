import {} from 'dotenv/config'
import { register, unregister, status, tipUser, gather_rewards  } from "./utils/transactions.js";
import { gatherableRewards, listAccounts, getBroPrice, getBroTreasury, isInSync } from "./utils/pactCalls.js";
import { promises as fs } from 'fs';
import path from 'node:path';
import { base64UrlDecode } from "@kadena/cryptography-utils";
import { checkHoldings } from './utils/verify_holdings.js';
import { TelegramClient, Api } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, Raw } from "telegram/events/index.js";
import { Decimal} from 'decimal.js'
import * as dateMath from 'date-arithmetic';

const PROFILE_PHOTO = "bot_profile.png"
const OATH = "oath.txt"
const INSTRUCTIONS = "instructions.txt"

const roomChatId = BigInt(process.env.ROOM_CHAT_ID);
const defaultChain = process.env.CHAINID;
const brons = process.env.BRO_NS;
const _bro_admins = process.env.BRO_ADMINS
const allowSelfTips = process.env.ALLOW_SELF_TIPS.toLowerCase() == "true"
var bro_admins_id = null;

const KICK_DELAY = parseInt(process.env.KICK_DELAY)
const KICK_DELAY_UNITS = process.env.KICK_DELAY_UNITS
const KICK_ENABLED = process.env.KICK_ENABLED.toLowerCase() == "true"

const KICK_DURATION = parseInt(process.env.KICK_DURATION)
const KICK_DURATION_UNITS = process.env.KICK_DURATION_UNITS
const LIQUIDITY_MULTIPLIER = Decimal(process.env.LIQUIDITY_MULTIPLIER)

const WAIT_ICON = "\u23f3"
const OK_ICON = "\u2705"
const NOK_ICON = "\u274c"
const POUTING_FACE = "\ud83d\ude21"
const DOLLARS = "\ud83d\udcb5"
const CONTRACT = "\ud83d\udcc4"


var client = null;
var me = null;


const build_cf = fname =>  fs.stat(fname)
                             .then(st => new CustomFile(path.basename(fname),st.size, fname))

const asset_path = (x) => fs.statfs("./"+x)
                            .then(()=>"./"+x)
                            .catch(()=> fs.statfs("./assets/"+x)
                                          .then(()=>"./assets/"+x))

const photo_profile_path = () => asset_path(PROFILE_PHOTO)


const _read = f  => fs.readFile(f, {encoding:'utf8'})

const update_photo_profile = () => photo_profile_path()
                                  .then(build_cf)
                                  .then(cf => client.uploadFile({file:cf, workers:1}))
                                  .then(uf => client.invoke(new Api.photos.UploadProfilePhoto({file:uf})))
                                  .catch(err => {console.log("Unable to load the bot photo"); console.error(err)})


const get_oath = () => asset_path(OATH)
                       .then(_read)

const get_instructions = () => asset_path(INSTRUCTIONS)
                              .then(_read)

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err); })


const admins_list = () => bro_admins_id.map(x=>x.toString()).join(" / ")

async function convert_admin_ids ()
{
  const get_admin = async (x) => await client.getEntity(x).then((u) => u.id.value)
                                             .catch(() => {console.warn(`Admin ${x} doesn't exist in TG`); return null })

  bro_admins_id = (await Promise.all(_bro_admins.split(" ").map(get_admin))).filter(x => x != null)
  console.log(`BRO Admins: ${admins_list()}`)
}


const brothers_ids = () => client.getParticipants(roomChatId)
                                 .then(list=> list.filter(x => !x.bot).map( x=> x.id.value))

const send_tmp_message = (peer, data) => client.sendMessage(peer, data)
                                               .then(msg => setTimeout( () =>msg.delete({revoke:true}), 30_000));


const kick_delay_map = new Map()


/* WARMUP stuffs */
const WARMUP_START = new Date('2024-05-31T12:00:00Z');
const WARMUP_END = new Date('2024-06-19T13:00:00Z');
const WARMUP_DURATION = dateMath.diff(WARMUP_START, WARMUP_END, "hours")

const in_warmup = () => (new Date() < WARMUP_END)
const WARMUP_KICK_DELAY = 48 /*Warning use same units as .env file */

/* The algorithm works by ranking people by TGId modulo WARMUP_TIME */
/* Then rank are compared with the time elapsed since the WARMUP to gradually includes people in the system */

const kick_delay = () => in_warmup()?WARMUP_KICK_DELAY:KICK_DELAY;
const _warmup_filter = tgId =>  tgId%BigInt(WARMUP_DURATION) < dateMath.diff(WARMUP_START, new Date, "hours")
const warmup_filter = lst => lst.filter(_warmup_filter);


async function kick(id)
{
  const user =  await client.getEntity(id);
  const room =  await client.getEntity(roomChatId);

  console.log("------- KICK -------")

  if(await is_admin(id))
  {
    console.log(`@${user.username} must be kicked manually`);
    await client.sendMessage(roomChatId, {message:`@${user.username} is an admin... Please kick him manually`})
  }
  else
  {
    await client.sendMessage(roomChatId, {message:`@${user.username} has been kicked for ${KICK_DURATION} ${KICK_DURATION_UNITS}`})
    const end_time = dateMath.add(new Date, KICK_DURATION, KICK_DURATION_UNITS)

    await client.invoke( new Api.channels.EditBanned({channel: room,
                                                      participant:user,
                                                      bannedRights: new Api.ChatBannedRights({
                                                        untilDate: Math.round(end_time.getTime()/1000),
                                                        viewMessages: true,
                                                        sendMessages: true
        }),
      }));
    kick_delay_map.delete(id)
  }
}

function update_kick_delay(id)
{
  /* Return the delay until kick */
  const current_kick_date = kick_delay_map.get(id);
  const now = new Date

  if(current_kick_date)
  {
    if(now>=current_kick_date)
    {
      if(KICK_ENABLED) {
        setTimeout(()=> kick(id), 15_000)
      }
      return "Now";
    }
    else
      return `in ${dateMath.diff(now, current_kick_date, KICK_DELAY_UNITS)} ${KICK_DELAY_UNITS}`;
  }
  else
  {
    kick_delay_map.set(id, dateMath.add(now, kick_delay(), KICK_DELAY_UNITS))
    return `in ${kick_delay()} ${KICK_DELAY_UNITS}`;
  }
}


async function verify_holdings(msg_if_ok, ids_to_check=null)
{
  if(!await check_sync())
    return
  console.log("=========> VERIFY HOLDINGS")
  const result = await brothers_ids()
                       .then(warmup_filter)
                       .then(x=> ids_to_check?x.filter(y=> ids_to_check.includes(y)):x)
                       .then(checkHoldings)
  console.log(`${result.length} brothers to be verified`)
  result.filter((x) => !x.registered).forEach( async ({id}) => {const {username} = await client.getEntity(id);
                                                                const delay = update_kick_delay(id)
                                                                 await client.sendMessage(roomChatId, {message:`@${username}: Your $BRO account is not registered:\n`
                                                                                                                + "  __- Please register your account with /register k:xxx....xxx__\n"
                                                                                                                + `  __- You will be kicked ${delay}__`,
                                                                                                       parseMode:"markdown"})
                                                               })

  result.filter((x) => x.registered && !x.holds).forEach( async ({id}) => {const {username} = await client.getEntity(id);
                                                                           const delay = update_kick_delay(id)
                                                                           await client.sendMessage(roomChatId, {message:`@${username}: You don't hold the required $BRO for being member of this group\n`
                                                                                                                          + "  __- Please buy 0.2 $BRO__\n"
                                                                                                                          + `  __- You will be kicked ${delay}__`,
                                                                                                                 parseMode:"markdown"})
                                                                           })

  result.filter((x) => x.registered && x.holds).forEach( ({id})=>{kick_delay_map.delete(id)})

  if(msg_if_ok)
  {
    if(result.filter((x)=> !x.registered || !x.holds).length == 0)
      await client.sendMessage(roomChatId, {message:`Registration and Holdings OK for ${result.length} members`})
  }
}



async function check_sync()
{
  const isSync = await isInSync();
  if(!isSync)
  {
    console.warn("WARNING! Node out of sync")
    await client.sendMessage(roomChatId, {message:"Bot Warning, node out of sync"})
  }
  return isSync;
}

const getParticipant = (user) => client.invoke( new Api.channels.GetParticipant({channel: roomChatId, participant:user}))
                                       .then(x => x.participant)
                                       .catch(() => null)

const is_admin = (user) => getParticipant(user).then(x=>x?.className=="ChannelParticipantAdmin" || x?.className =="ChannelParticipantCreator")


async function check_bot()
{
  me = await client.getEntity('me')
  console.log(`Bot @${me.username} / ${me.id}`)

  try
  {
    const group = await client.getEntity(roomChatId)
    console.log(`Group @${group.title} / ${group.id}`)
  }
  catch
  {
    console.error("WARN: Unable to retrieve group")
    return false;
  }


  if(!await is_admin(me))
  {
      console.error("WARN: I'm no Admin of that group");
      return false;
  }
  return true;
}

const stop_abuse_set = new Set()

function check_abuse(chatId, sender)
{
  const key = sender.id.toString()
  if(stop_abuse_set.has(key))
  {
    console.log(`Anti abuse triggered by @${sender.username}`)
    send_tmp_message(chatId, {message:`@${sender.username} Please stop spamming ${POUTING_FACE}`})
    return true;
  }
  else
  {
    stop_abuse_set.add(key);
    setTimeout(() => stop_abuse_set.delete(key), 60_000)
    return false;
  }
}

async function ensure_main_channel(msg)
{
  if(msg.chatId.value != roomChatId)
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Command available only on the Brothers channel`})
    return false;
  }
  return true;
}

async function ensure_is_pm(msg)
{
  if(msg.chatId.value != msg.senderId.value)
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Command available only in PM`})
    return false;
  }
  return true;
}

async function ensure_is_brother(msg)
{
  const brothers = await brothers_ids()
  if(!brothers.includes(msg.senderId.value))
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Command available only for Brothers`})
    return false;
  }
  return true;
}

async function ensure_is_admin(msg)
{
  if(! await is_admin(msg.senderId))
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Command available only for the Brothers Group admin's`})
    return false;
  }
  return true;
}

async function ensure_is_BRO_admin(msg)
{
  if(!bro_admins_id.includes(msg.senderId.value))
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Command available only for the Brothers admin's`})
    return false;
  }
  return true;
}


async function on_register(msg)
{
  await msg.delete({revoke:true})
  if(!(await ensure_is_brother(msg)))
    return;
  const sender = await msg.getSender()
  const [, acct] = msg.message.split(" ");
  console.log(`Register => ${sender.id} / ${sender.username} / ${msg.chatId} / ${acct}`)

  if(!acct)
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Please register with \`/register k:...\``})
    return;
  }

  if(check_abuse(msg.chatId, sender))
    return;

  const answer = await client.sendMessage(msg.chatId, {message:`${WAIT_ICON} Got it: Registering @${sender.username}`})

  register(sender.id, acct, defaultChain)
  .then(status)
  .then(data => data?.result?.status == 'success'?answer.edit({text:`${OK_ICON} Register successful @${sender.username}`})
                                                 :answer.edit({text:`${NOK_ICON} Registration error @${sender.username}`}))
  .catch(error => answer.edit({text:`${NOK_ICON} Registration error @${sender.username}\n ${error}`}))
  .then(msg => setTimeout( () =>msg.delete({revoke:true}), 3600_000)); /*Do we need to remove old messages */
}

async function on_unregister(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 3600_000);
  if(!await ensure_is_BRO_admin(msg))
    return;
  const acct = await argUser(msg)
  console.log(`UnRegister => ${acct.username}`)
  if(!acct)
    return;

  const answer = await client.sendMessage(msg.chatId, {message:`${WAIT_ICON} Got it: UnRegistering @${acct.username}`})

  unregister(acct.id, defaultChain)
  .then(status)
  .then(data => data?.result?.status == 'success'?answer.edit({text:`${OK_ICON} UnRegister successful @${acct.username}`})
                                                 :answer.edit({text:`${NOK_ICON} UnRegistration error @${acct.username}`}))
  .catch(error => answer.edit({text:`${NOK_ICON} UnRegistration error @${acct.username}\n ${error}`}))
  .then(msg => setTimeout( () =>msg.delete({revoke:true}), 3600_000)); /*Do we need to remove old messages */
}


async function on_status(msg)
{
  const sender = await msg.getSender()
  await msg.delete({revoke:true})
  try
  {
    await client.sendMessage(sender, {parseMode:"markdown", message:"**------------------------------**\n**Your Bro status:** \n **------------------------------**"})
  }
  catch
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Privacy reason: Please open a DM with me`});
    return;
  }

  const [{account, bal, hold, liquidity, registered, holds}] = await checkHoldings([sender.id.toString()])

  await client.sendMessage(sender, {parseMode:"md", message:`**Kadena account:** \`${account?account:NOK_ICON}\``})
  await client.sendMessage(sender, {parseMode:"md", message:`**Balance:** \`${hold.toString()} $BRO\``})
  await client.sendMessage(sender, {parseMode:"md", message:`**Liquidity:** \`${liquidity.toString()} $BRO\` (x ${LIQUIDITY_MULTIPLIER.toFixed(1)})`})
  await client.sendMessage(sender, {parseMode:"md", message:`**Total:** \`${bal.toString()} $BRO\``})
  await client.sendMessage(sender, {parseMode:"md", message:`**Are you a brother:** ${(registered && holds)?OK_ICON:NOK_ICON}`})

}

async function on_verify_holdings(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 3600_000);
  if(!await ensure_is_BRO_admin(msg))
    return;

  const user = await argUser(msg)
  if(user)
    await verify_holdings(true, [user.id.value])
  else
    await verify_holdings(true);
}

async function on_price(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 3600_000);
  if(!(await ensure_main_channel(msg)))
    return;
  await getBroPrice()
        .then(p => client.sendMessage(msg.chatId, {message:`${DOLLARS} ${p.toString()} KDA / $BRO ${DOLLARS}`}))
        .then(answer => setTimeout(() => answer.delete({revoke:true}), 3600_000));
}

async function on_treasury(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 3600_000);
  const {main, liquidity_bro, liquidity_coin}  = await getBroTreasury()
  await client.sendMessage(msg.chatId, {parseMode:"markdown", message:"**Brothers Treasury Balance:** \n"
                                                               +  `  - **Main treasury**: \`${main.toFixed(3)} $BRO\` \n`
                                                               +  `  - **Dex liquidity **: \`${liquidity_bro.toFixed(3)} $BRO\` \n`
                                                               +  `  - **Dex liquidity **: \`${liquidity_coin.toFixed(3)} KDA\` \n`})
              .then(answer => setTimeout(() => answer.delete({revoke:true}), 3600_000));
}


function on_contract(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 3600_000);
  return client.sendMessage(msg.chatId, {parseMode:"md", message:`${CONTRACT} \`${brons}.bro\` `})
               .then(answer => setTimeout(() => answer.delete({revoke:true}), 3600_000));
}

function on_donation(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 3600_000);
  return  client.sendMessage(msg.chatId, {parseMode:"md", message:`Donation account: ${CONTRACT} \`r:${brons}.community\` `})
                .then(answer => setTimeout(() => answer.delete({revoke:true}), 3600_000));
}

function _break_array(input)
{
  const results = [];
  while (input.length)
    results.push(input.splice(0, 10));
  return results;
}

async function on_list(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 3600_000);
  if(!await ensure_is_pm(msg) || !await ensure_is_BRO_admin(msg))
    return;
  /* TG limits messages size => We break the lists of registered accounts into sublists of 10 elements and send them one by one */
  await listAccounts()
        .then(l => l.map(({"tg-account-enc":tga, "bro-account":bro}) => `**${tga}** =>>  \` ${base64UrlDecode(bro)}\` `))
        .then(_break_array)
        .then(l => l.map(x=> x.join("\n")))
        .then(l => Promise.all(l.map(s=> client.sendMessage(msg.chatId, {parseMode:"md", message:s}))));
}

function repliedUser(msg)
{
  if(!msg.replyTo)
    return null;
  return client.getMessages(roomChatId, {ids:msg.replyTo.replyToMsgId})
               .then(x=>x[0].fromId)
               .then(x => client.getEntity(x))
}

function argUser(msg)
{
  const [, _username] = msg.message.split(" ");
  if(!_username)
    return null;
  return client.getEntity(_username)
               .catch( (err) => {send_tmp_message(msg.chatId, {message:`${NOK_ICON} ${_username} not found: ${err.toString()}`}); return null})
}


async function on_tip(msg) {
  setTimeout(() => msg.delete({revoke:true}), 3600_000);

  /* Only admins can tip */
  if(!await ensure_is_admin(msg) || !await ensure_main_channel(msg))
    return;

  // Extract the username from the message text
  const user = await repliedUser(msg) ?? await argUser(msg)

  if (!user)
  {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Invalid command format. Please use: /tip @username or replied to another message`})
    return;
  }

  /* Verify that this user is a Brother */
  if(! (await brothers_ids()).includes(user.id.value)) {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} ${user.username} is not a brother`})
    return;
  }

  /* Check holdings we only tip users who have the required holdings*/
  const [{holds}] = await checkHoldings([user.id.toString()])
  if (!holds) {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} ${user.username} doesn't have a funded $BRO account`})
    return;
  }

  if (!allowSelfTips && user.id.value == msg.senderId.value) {
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} ${user.username} You want to tip yourself. Are you kidding? `})
    return;
  }

  const answer = await client.sendMessage(msg.chatId, {message:`${WAIT_ICON} Tipping ${user.username}`})

  tipUser(user.id.value)
  .then(status)
  .then(data => data?.result?.status == 'success'?answer.edit({text:`${OK_ICON} Tipped ${user.username}`})
                                                 :answer.edit({text:`${NOK_ICON} Tip Error ${user.username}`}))
  .catch(error => answer.edit({text:`${NOK_ICON} Tip error @${user.username}\n ${error}`}))
  }

async function do_auto_pump()
{
  console.log("====> AUTO PUMPING")
  const gatherable_rewards = await gatherableRewards();
  console.log(`Rewards available: ${gatherable_rewards}`)
  if(gatherable_rewards.gte(Decimal("0.01")))
  {
    console.log("Auto pumping")
    const msg = await client.sendMessage(roomChatId, {message:`${WAIT_ICON} Auto-pumping $BRO in progress`})
    gather_rewards()
    .then(status)
    .then(data => data?.result?.status == 'success'?msg.edit({text:`${OK_ICON} Auto-pump successful`})
                                                   :msg.edit({text:`${NOK_ICON} Auto-pump error`}))
    .catch(error => msg.edit({text:`${NOK_ICON} Auto-pump error ${error}`}))
    .then(msg => setTimeout( () =>msg.delete({revoke:true}), 3600_000))
    .then(getBroPrice)
    .then((p) => client.sendMessage(roomChatId, {message:`${DOLLARS} New price: ${p.toString()} KDA / $BRO ${DOLLARS}`}))
    .then(answer => setTimeout(() => answer.delete({revoke:true}), 3600_000));
    return true;
  }
  else
  {
    console.log("Not enough rewards to gather=> Cancel")
    return false;
  }

}


async function on_auto_pump(msg)
{
  setTimeout(() => msg.delete({revoke:true}), 120_000);
  if(!await ensure_is_BRO_admin(msg))
    return;
  if(!await do_auto_pump())
    await send_tmp_message(msg.chatId, {message:`${NOK_ICON} Auto pumping not possible now`})
}

async function on_oath(msg)
{
  if(!(await ensure_is_brother(msg)))
    return;
  await get_oath()
        .then(m=> client.sendMessage(msg.chatId, {parseMode:"md", message:m}))
        .then(answer => setTimeout(() => answer.delete({revoke:true}), 3600_000));
}


async function on_help(msg)
{
  const chat = await msg.getChat()

  const answer = await client.sendMessage(chat,{parseMode:"markdown", message:"**Brothers Bot Help:** \n"
                                                                            +  "  - **/register k:xxx...xxx**: __Register a Kadena account__\n"
                                                                            +  "  - **/unregister (@tgaccount)**: __Unregister an account (only Bro bot admins)__\n"
                                                                            +  "  - **/status**: __Give my registration and $BRO holding status (PM only)__\n"
                                                                            +  "  - **/verify (@tgaccount)**: __Force members $BRO holdings verification (only Bro bot admins)__\n"
                                                                            +  "  - **/price**: __Give me the current price of $BRO__\n"
                                                                            +  "  - **/contract**: __Gives $BRO contract__\n"
                                                                            +  "  - **/oath**: __Send the Borthers Oath__\n"
                                                                            +  "  - **/treasury**: __Gives $BRO  treasury details__\n"
                                                                            +  "  - **/auto_pump**: __Force $BRO auto-pump  (only for Bro bot admins)__\n"
                                                                            +  "  - **/list**: __List encrypted registered accounts (only in PM, and for Bro bot admins)__\n"
                                                                            +  "  - **/donate amount**: __Donate some $BRO to the community__\n"
                                                                            +  "  - **/tip (@tgaccount=)*: __Tip an account or tip the replied message (only for TG group admins)__\n"})
  setTimeout( () =>answer.delete({revoke:true}), 60_000)
  setTimeout( () =>msg.delete({revoke:true}), 60_000)
}

const MSG_HANDLERS = {"/help":on_help,
                      "/register":on_register,
                      "/unregister":on_unregister,
                      "/verify":on_verify_holdings,
                      "/status":on_status,
                      "/tip":on_tip,
                      "/contract":on_contract,
                      "/donate":on_donation,
                      "/oath": on_oath,
                      "/auto_pump": on_auto_pump,
                      "/list": on_list,
                      "/treasury": on_treasury,
                      "/price": on_price}

async function handle_msg(msg)
{
  try
  {
    const [cmd,] = msg.message.split(" ");
    const handler = MSG_HANDLERS[cmd]
    if(handler)
      await handler(msg)
  }
  catch(err)
  {
    setTimeout(() => send_tmp_message(msg.chatId, {message:`${NOK_ICON} Unexpected error happened... \n Is the Kadena node reachable ? \n Check the logs please.`}), 1000)
    console.error(`Unexpected error with message ${msg.message}`)
    console.error(err);
  }
}


async function handle_new_participant(ev)
{
  if(ev?.newParticipant?.userId)
  {
    console.log("New participant detected => Checking")
    const new_user = await client.getEntity(ev.newParticipant)
    console.log(`New user = ${new_user.username}`)
    await get_oath()
          .then(m=> client.sendMessage(roomChatId, {parseMode:"md", message:m + `\n 💡 Please take the oath by thumbing this message @${new_user.username}`}))
          .then(answer => setTimeout(() => answer.delete({revoke:true}), 259200_000))
          .then(get_instructions)
          .then(m=> client.sendMessage(roomChatId, {parseMode:"md", message:`Please read carefully @${new_user.username}\n\n`+m}))
          .then(answer => setTimeout(() => answer.delete({revoke:true}), 3600_000))
          .then(() => verify_holdings(true, [ev.newParticipant.userId.value]))
  }

}

async function startup_message()
{
  console.log(`Bot Starting: => Advertising ${roomChatId}`)
  await client.sendMessage(roomChatId, {parseMode:"markdown", message:"**Brothers Bot v2.0 Started** \n__Take care, Stu is watching you__"})
}

async function run()
{
  console.log("===> Checking the required files")
  await get_oath().catch(()=> console.error(`Cannot find ${OATH}`))
  await get_instructions().catch(()=> console.error(`Cannot find ${INSTRUCTIONS}`))

  console.log("===> Connecting to TG")
  const session = await fs.readFile("session.txt", "ascii")
                          .then((data) => new StringSession(data))
                          .catch((err) => {console.warn(`No stored session, login again: ${err}`); return new StringSession("")})

  client  = new TelegramClient(session, parseInt(process.env.API_ID), process.env.API_HASH)
  await client.start({botAuthToken:process.env.BOT_TOKEN})

  await fs.writeFile("session.txt", session.save())

  await update_photo_profile()

  await convert_admin_ids();
  await check_bot()

  console.log("===> Checking the block-chain")
  await check_sync()

  client.addEventHandler( (ev) => handle_msg(ev.message), new NewMessage({}))
  client.addEventHandler( (ev) => handle_new_participant(ev), new Raw({types:[Api.UpdateChannelParticipant]}))
  await startup_message()
  await verify_holdings()
  await do_auto_pump()
  setInterval(verify_holdings, 3600_000);
  setInterval(do_auto_pump, 6*3610_000);
  //console.log(await client.getParticipants(roomChatId))
}

run()
