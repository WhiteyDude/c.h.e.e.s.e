const Discord = require('discord.js');
const discord = new Discord.Client();
const rcon_client = require("rcon-client");
const fetch = require('node-fetch');
const config = require('config')
const ioredis = require('ioredis')
const redis = new ioredis();

// vars
const rcon_options = {
  'host':     config.get('rcon.host'),
  'port':     config.get('rcon.port'),
  'password': config.get('rcon.password')
}
const valid_server_ids =  config.get('discord.valid-servers')
const admin_channel_ids = config.get('discord.admin-channels')
const whitelist_channel = config.get('discord.whitelist-channel')
const sponsor_role =      config.get('discord.sponsor-role')
const pleb_role =         config.get('discord.pleb-role')
const admin_role =        config.get('discord.admin-role')
const discord_token =     config.get('discord.token')

let last_message = {}

// rcon
const rcon = new rcon_client.Rcon()

function rcon_connect() {
  return new Promise(function(resolve, reject) {
    if (!rcon.socket) {
      rcon.connect(rcon_options)
      .then( () => resolve(true) )
      .catch( (err) => reject(err))
    }
    else {
      resolve(true)
      return
    }
  });
}

function rcon_send(command) {
  return new Promise(function(resolve, reject) {
    rcon_connect()
    .then(() => {
      rcon.send(command)
      .then( (response) => {
        resolve(response)
      })
      .catch( (err) => {
        reject(err)
      })
    })
  });
}

function validateServer(id) {
  return valid_server_ids.includes(id)
}

function fromAdminChannel(id) {
  return admin_channel_ids.includes(id)
}

function hasAdminRole(user_object) {
  return checkUserForRole(user_object, admin_role)
}

function cleanString(string) {
  // Strips Minecraft control codes:
  return string.replace(/B\'./g, "")
}

function checkUserForRole(user_object, role_id) {
  return user_object.roles.cache.has(role_id)
}

function getMinecraftIdFromPlayerName(playername) {
  return new Promise(function(resolve, reject) {
    console.log(`Looking up ${playername}`)
    if (!/^\w{3,16}$/i.test(playername)) { reject(false) }
    fetch(`https://api.mojang.com/users/profiles/minecraft/${playername}`)
      .then(data => data.json())
      .then(player => resolve(player.id))
      .catch(err => reject(false))
  })
}

// discord listeners
discord.on('ready', () => {
  console.log(`Logged in as ${discord.user.tag}!`);
});

discord.on('message', msg => {
  // Ignore non server messages
  if (msg.channel.type != 'text') { return }
  // Dump for bad server
  if (!validateServer(msg.channel.guild.id)) {
    console.error(`Invalid server - looks like we're on ${msg.guild.id} (${msg.guild.name})`)
    return
  }

  // Rate limiter
  if (msg.content.startsWith('!')) {
    if (last_message[msg.author.id]) {
      if ( Math.floor(Date.now() / 1000) - last_message[msg.author.id] < 5) {
        console.log(`${msg.author.username}#${msg.author.discriminator} is rate limited`)
        return
      }
    }
    last_message[msg.author.id] = Math.floor(Date.now() / 1000)
  }

  // Specific channel checks
  if (msg.channel.id == whitelist_channel) {
    // Checks to add:
    // user object in emote reaction is incorrect, it's the message user not the reactor
    message = msg.content.split(' ')
    if (message[0] != '!whitelist' || message.length != 3 || msg.mentions.users.size != 1) {
      msg.delete().then(msg => console.log(`Deleted message from ${msg.author.username}#${msg.author.discriminator} in whitelist channel due to bad format`))
      msg.author.send(`Your message was deleted in ${msg.channel.name} due to bad formatting. Try again!`)
      return
    }
    if (checkUserForRole(msg.member, sponsor_role)) {
      msg.delete().then(msg => console.log(`Deleted message from ${msg.author.username}#${msg.author.discriminator} as they already had the sponsor role`))
      msg.author.send(`Your message was deleted in ${msg.channel.name} as you're already whitelisted!`)
      return
    }
    getMinecraftIdFromPlayerName(message[1])
    .then( (uid) => {
      if (!checkUserForRole(msg.mentions.members.first(), sponsor_role)) {
        msg.delete().then(msg => console.log(`Deleted message from ${msg.author.username}#${msg.author.discriminator} due to bad sponsor`))
        msg.author.send(`Your message was deleted in ${msg.channel.name} as you did not tag a valid sponsor to sponsor you. The sponsor must have the "Lewser" role on the server!`)
        return
      }
      else {
        sponsor_user_id = msg.mentions.users.first()['id']
        if (sponsor_user_id == msg.author.id) {
          msg.delete().then(msg => console.log(`Deleted message from ${msg.author.username}#${msg.author.discriminator} due to requesting self sponsor`))
          msg.author.send(`Your message was deleted in ${msg.channel.name} as you did not tag a valid sponsor to sponsor you. You can't sponsor yourself.`)
          return
        }
        sponsor_user = msg.mentions.users.first()
        msg.react('✅').then(r => msg.react('❌'))
        msg.awaitReactions(
          (reaction, user) => user.id == sponsor_user_id && (reaction.emoji.name == '✅' || reaction.emoji.name == '❌'),
          { max: 1, time: 300000 })
          .then(collected => {
            if (collected.first().emoji.name == '✅') {
              addUserToWhitelist(uid, message[1], msg.member, msg.mentions.members.first())
              .then( (response) => {
                msg.member.roles.add(msg.guild.roles.cache.get(pleb_role))
                sponsor_user.send(`You have now sponsored ${msg.author.username}#${msg.author.discriminator} (${message[1]}) on the server. You are responsible for them following the rules. Please ensure they do!`)
                console.log(`${sponsor_user.username}#${sponsor_user.discriminator} has sponsored ${msg.author.username}#${msg.author.discriminator} (${message[1]})`)
                msg.author.send(`You have been whitelisted. Please check the #rules channel to see connection information. Please note that ${sponsor_user.username}#${sponsor_user.discriminator} risks being banned if you do not follow the rules. Have fun!`)
              })
              .catch( (response) => {
                msg.reply(response)
              })
            }
            else {
              sponsor_user.send(`${msg.author.username}#${msg.author.discriminator} (${message[1]})'s request for your sponsorship has been denied.`)
              msg.author.send(`${sponsor_user.username}#${sponsor_user.discriminator} has refused to sponsor you. If you believe this is in error, you should contact them privately about this.`)
              console.log(`${sponsor_user.username}#${sponsor_user.discriminator} has refused to sponsor ${msg.author.username}#${msg.author.discriminator} (${message[1]})`)
            }
            msg.delete()
          })
          .catch((err) => {
            console.log(err)
            console.log(`${sponsor_user.username}#${sponsor_user.discriminator} request to sponsor ${msg.author.username}#${msg.author.discriminator} (${message[1]}) denied due to timeout`)
            msg.author.send(`Your sponsorship request has been denied, as your elected sponsor did not react in time. Please message them and ensure they're around before trying again.`)
            msg.delete()
          });
          return
        }
      })
      .catch( (err) => {
        console.warn(err)
        msg.delete().then(msg => console.log(`Deleted message from ${msg.author.username}#${msg.author.discriminator} in whitelist channel due to bad minecraft username ${message[1]}`))
        msg.author.send(`The Minecraft username you provided was invalid. Please check and try again!`)
        return
    })
  }

  ///// Admin commands
  if (msg.content === '!whiteytest') {
    //if (!fromAdminChannel(msg.channel.id)) {
    if (!hasAdminRole(msg.member)) {
        //console.log(`${msg.author.username}#${msg.author.discriminator} tried to run ${msg.content} in ${msg.channel.name}, denied`)
        return
    }
    msg.reply("Correct channel!")
    return
  }

  if (msg.content.startsWith('!adminsponsor')) {
    if (!hasAdminRole(msg.member)) {
      console.log(`${msg.author.username}#${msg.author.discriminator} tried to run ${msg.content} in ${msg.channel.name}, denied`)
      return
    }
    message = msg.content.split(' ')
    if (message.length != 3 || msg.mentions.members.size != 1) {
      msg.reply(`Syntax is ${message[0]} <minecraft-username> <tagged-discord-user>`)
      return
    }
    getMinecraftIdFromPlayerName(message[1])
    .then( (uid) => {
      user = msg.mentions.members.first()
      addUserToWhitelist(uid, message[1], user, msg.member)
      .then( (result) => {
        user.roles.add(msg.guild.roles.cache.get(pleb_role))
        console.log(`${msg.member.user.username}#${msg.member.user.discriminator} has sponsored ${user.user.username}#${user.user.discriminator} (${message[1]})`)
        msg.reply(`You have sponsored ${message[1]} and they're now whitelisted. They also have the Pleb role.`)
      })
      .catch( (result) => {
        msg.reply(result)
      })
    })
    .catch( (err) => {
      console.warn(err)
      msg.reply(`The Minecraft username you provided was invalid. Please check and try again!`)
    })
    ;
  }

  function addUserToWhitelist(minecraft_uid, minecraft_username, member, sponsor_member) {
    return new Promise(function(resolve, reject) {
      rcon_send(`whitelist add ${minecraft_username}`)
      .then( (result) => {
        if (result.includes("already whitelisted")) {
          reject(`Error adding ${minecraft_username} to the whitelist, they're already on the whitelist!`)
        }
        msg.member.roles.add(msg.guild.roles.cache.get(pleb_role))
        redis.hmset(`player::${minecraft_uid}`, {
          'discord_name': `${member.user.username}#${member.user.discriminator}`,
          'discord_id': member.user.id,
          'sponsor_name': `${sponsor_member.user.username}#${sponsor_member.user.discriminator}`,
          'sponsor_id': sponsor_member.user.id,
          'minecraft_name': minecraft_username
        })
        resolve(true)
      })
      .catch( (err) => {
        console.log(err)
        reject(`General error adding ${minecraft_username} to the whitelist. Please contact an admin in #help`)
      });
    });
  }

  ///// Normal user commands
  if (msg.content === '!who') {
    rcon_send("who")
    .then( (response) => {
        let clean_response = cleanString(response)
        msg.reply(clean_response);
        return
    })
    .catch( (err) => {
        console.warn("Error running /who on server:", err)
        msg.reply("Error running command")
    });
  }

  if (msg.content.startsWith('!sponsor')) {
    message = msg.content.split(' ')
    if (message.length != 2) {
      msg.reply(`Syntax is ${message[0]} <minecraft-username>`)
      return
    }
    getMinecraftIdFromPlayerName(message[1])
    .then( (uid) => {
      redis.hgetall(`player::${uid}`)
      .then( (result) => {
        name = (message[1] == result['minecraft_name']) ? message[1] : `${message[1]}/${result['minecraft_name']}`
        msg.reply(`Sponsor for ${name} was ${result['sponsor_name']}.`)
        return
      })
      .catch( (err) => {
        // Assuming it's always the UID not existing in the list
        console.log(err)
        msg.reply(`This Minecraft user has not been sponsored on the server.`)
      })
    })
    .catch( (err) => {
      console.log(err)
      msg.reply('Invalid Minecraft username provided, please check the spelling and try again.')
      return
    })
  }
});
  
// main

function main() {
    rcon_connect()
    .catch( (err) => {
        throw err
    })
    discord.login(discord_token);
}

main()