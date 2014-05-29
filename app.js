var express = require('express');
var path = require('path');
var favicon = require('static-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var cookieSession = require('cookie-session');
var bodyParser = require('body-parser');
var uid = require('uid2');
var utils = require('lockit-utils');
var Lockit = require('lockit');
var Adapter = require('lockit-mongodb-adapter');

var routes = require('./routes/index');
var config;

try {
  config = require('./config.prod.js');
} catch(e) {
  console.log('reading environment variables from Heroku ...');
}

// read config from heroku environment vars
config = config || {
  appname: process.env.APPNAME,
  url: process.env.URL,
  emailFrom: process.env.EMAIL,
  emailType: process.env.TYPE,
  emailSettings: {
    service: process.env.SERVICE,
    auth: {
      user: process.env.USER,
      pass: process.env.PASS
    }
  },
  db: {
    url: process.env.DB,
    name: process.env.NAME,
    collection: process.env.COLLECTION
  }
};

var adapter = new Adapter(config);
var lockit = new Lockit(config);

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(cookieSession({
  secret: 'abcd1234'
}));
app.use(express.static(path.join(__dirname, 'public')));

// put lockit.router before your own middleware
// your routes have access to res.locals.name and res.locals.email
app.use(lockit.router);

// own routes
app.use('/', routes);

// settings page
app.get('/settings', utils.restrict(config), function(req, res) {
  var email = req.session.email;
  // get user from db
  adapter.find('email', email, function(err, user) {
    if (err) return next(err);
    function render(key) {
      var options = {
        key: key,
        email: email
      };
      return res.render('settings', {
        title: 'Settings',
        qr: utils.qr(options),
        enabled: user.twoFactorEnabled
      });
    }
    // check if user already has a key
    if (user.twoFactorKey) return render(user.twoFactorKey);
    // generate random key for two-factor authentication
    user.twoFactorKey = uid(20);
    // save (new) key to db
    adapter.update(user, function(err, user) {
      if (err) return next(err);
      render(user.twoFactorKey);
    });
  });
});

// post settings handler
app.post('/settings', utils.restrict(config), function(req, res) {
  // get user from db to get the key
  adapter.find('email', req.session.email, function(err, user) {
    if (err) return next(err);
    var token = req.body.token;
    var key = user.twoFactorKey;
    var valid = utils.verify(token, key);
    if (valid) {
      // update user in db
      user.twoFactorEnabled = true;
      adapter.update(user, function(err, user) {
        if (err) return next(err);
        res.send('two-factor auth now enabled.\n log out and back in');
      });
      return;
    }
    var options = {
      key: key,
      email: req.session.email
    };
    var qr = utils.qr(options);
    res.render('settings', {
      title: 'Settings',
      qr: qr,
      error: 'Token invalid'
    });
  });
});

app.post('/disable', utils.restrict(config), function(req, res) {
  var email = req.session.email;
  adapter.find('email', email, function(err, user) {
    if (err) return next(err);
    delete user.twoFactorKey;
    delete user.twoFactorEnabled;
    adapter.update(user, function(err, user) {
      if (err) return next(err);
      res.redirect('/settings');
    });
  });
});

/// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

/// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});


var debug = require('debug')('lockit-demo');
app.set('port', process.env.PORT || 3000);
var server = app.listen(app.get('port'), function() {
  debug('Express server listening on port ' + server.address().port);
});
