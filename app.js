/**
 * Module Dependencies
 */

var express = require('express'),
  util = require('util'),
  mongoose = require('mongoose'),
  everyauth = require('everyauth'),
  stylus = require('stylus'),
  nib = require('nib'),
  env = require('./cfg/env'),
  port = env.port,
  secrets = env.secrets,
  dispatchListener = require('./logic/dispatchlistener'),
  Player = require('./models/player');

mongoose.connect(env.mongo_url);

var app = module.exports = express.createServer();


/**
 * Everyauth Configuration
 */

everyauth.everymodule.moduleTimeout(8000); // Wait 8 seconds per step before timing out (default is 10)
everyauth.everymodule.findUserById( function (req, userId, callback) {
  Player.findById(userId, callback);
  // callback has the signature, function (err, user) {...}
});
everyauth.everymodule.handleLogout( function (req, res) {
  delete req.session.auth; // This is what req.logout() does
  this.redirect(res, this.logoutRedirectPath());
  if (req.user) {
    // disconnect: false, otherwise the client's page will display a premature d/c warning
    dispatchListener.emit('findAndDestroyUser', req.user.id, null, {disconnect: false});
  }
});
everyauth.steam
  .myHostname( env.hostname )
  .findOrCreateUser( function (session, openIdUserAttributes) {
    var promise = this.Promise();
    var steamid;
    try {
      steamid = openIdUserAttributes.claimedIdentifier.split('/').slice(-1)[0];
      if (!steamid) throw new Error('No steamid???');
    } catch (e) {
      promise.fail(e);
      return promise;
    }
    Player.findById(steamid, function(err, player) {
      if (err) {
        console.log('Err looking up player', err);
        return promise.fail(err);
      }
      if (player) {
        // Update the player's info on login
        // Instead of just retrieving old info

        Player.getSteamApiInfo(steamid, function(err, steamInfo) {
          if (err) return promise.fail(err);

          player.name = steamInfo.personaname;
          player.avatar = steamInfo.avatar;
          player.updated = new Date();
          if (steamInfo.loccountrycode) {
            player.country = steamInfo.loccountrycode;
          }

          player.save(function(err) {
            if (err) {
              console.log('Err saving player', err);
              return promise.fail(err);
            }
            promise.fulfill(player);
          });
        });

      } else {

        Player.getSteamApiInfo(steamid, function(err, steamInfo) {
          if (err) return promise.fail(err);

          var newPlayer = new Player({
            _id: steamid,
            name: steamInfo.personaname,
            avatar: steamInfo.avatar,
            updated: new Date(),
            rank: 'newbie',
            permissions: 1
          });
          if (steamInfo.loccountrycode) {
            newPlayer.country = steamInfo.loccountrycode;
          }

          newPlayer.save(function(err) {
            if (err) {
              console.log('Error saving new player', err);
              return promise.fail(err);
            }
            promise.fulfill(newPlayer);
          });

        });

      }

      // session.save();

    });

    return promise;
  })
  .moduleErrback( function (err) {
    console.log( 'EVERYAUTH ERROR:', err);
  })
  .redirectPath('/');
// everyauth.debug = false;


/**
 * Express Configuration
 */

function compile(str, path) {
  return stylus(str)
    .set('filename', path)
    .set('compress', true)
    .use(nib());
}

app.configure(function(){
  app.use(express.favicon('public/img/favicon.ico'));
  // app.use(express.logger('dev'));
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.set('view options', {
    layout: false
  });

  // app.store = new express.session.MemoryStore;
  var RedisStore = require('connect-redis')(express);
  app.store = new RedisStore({
    prefix: 'nmsess',
    host: env.redis_host,
    port: env.redis_port,
    db: env.redis_db,
    pass: env.redis_password
  });

  app.use(express.cookieParser());
  app.use(express.session({
    secret: secrets.session,
    store: app.store
  }));

  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(everyauth.middleware());
  app.use(stylus.middleware({ src: __dirname + '/public', compile: compile }));
  app.use(express.static(__dirname + '/public'));
  app.use(app.router);
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes
require('./routes')(app);

// Hook Socket.io into Express
var parseCookie = require('connect').utils.parseCookie;
app.io = require('socket.io').listen(app);
app.io.enable('browser client minification');
app.io.enable('browser client etag');
app.io.enable('browser client gzip');
app.io.set('log level', 1);
app.io.set('transports', [
  'websocket',
  'flashsocket',
  'htmlfile',
  'xhr-polling',
  'jsonp-polling'
]);
var socket = require('./logic/socket')(app);

app.listen(port, function(){
  console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});