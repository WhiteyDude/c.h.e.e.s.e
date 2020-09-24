const Discord = require('discord.js');
const discord = new Discord.Client();
const rcon_client = require("rcon-client");
const fetch = require('node-fetch');
const config = require('config')


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
const discord_token =     config.get('discord.token')

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

function cleanString(string) {
  // Strips Minecraft control codes:
  return string.replace(/B\'./g, "")
}

function checkUserForRole(guild_object, user_object, role_id) {
  return guild_object.member(user_object)['_roles'].includes(role_id)
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
    if (!checkUserForRole(msg.channel.guild, msg.author, sponsor_role)) {
      msg.delete().then(msg => console.log(`Deleted message from ${msg.author.username}#${msg.author.discriminator} as they already had the sponsor role`))
      msg.author.send(`Your message was deleted in ${msg.channel.name} as you're already whitelisted!`)
      return
    }
    getMinecraftIdFromPlayerName(message[1])
    .then( (uid) => {
      if (!checkUserForRole(msg.channel.guild, msg.mentions.users.first(), sponsor_role)) {
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
              sponsor_user.send(`You have now sponsored ${msg.author.username}#${msg.author.discriminator} (${message[1]}) on the server. You are responsible for them following the rules. Please ensure they do!`)
              console.log(`${sponsor_user.username}#${sponsor_user.discriminator} has sponsored ${msg.author.username}#${msg.author.discriminator} (${message[1]})`)
              rcon_send(`whitelist add ${message[1]}`)
              .then( (result) => {
                if (result.includes("already whitelisted")) {
                  msg.author.send(`Error adding you to the whitelist, you're already on the whitelist!`)
                  return
                }
                msg.author.send(`You have been whitelisted. Please check the #rules channel to see connection information. Please note that ${sponsor_user.username}#${sponsor_user.discriminator} risks being banned if you do not follow the rules. Have fun!`)
                return
              })
              .catch( (err) => {
                console.log(err)
                msg.author.send(`Error adding you to the whitelist. Please notify an admin in #general!`)
                return
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
    if (!fromAdminChannel(msg.channel.id)) {
        console.log(`${msg.author.username}#${msg.author.discriminator} tried to run ${msg.content} in ${msg.channel.name}, denied`)
        return
    }
    msg.reply("Correct channel!")
    return
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
  if (msg.content === '!whitelist') {
    rcon_send("whitelist add WhiteyDude")
    .then( (response) => {
        let clean_response = cleanString(response)
        msg.reply(clean_response);
        return
    })
    .catch( (err) => {
        console.warn("Error running /whitelist on server:", err)
        msg.reply("Error running command")
    });
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