/** Setting up dependencies for login system. */
var express = require('express'),
    app = module.exports = express.createServer(),
    mongoose = require('mongoose'),
    mongoStore = require('connect-mongodb'),
    schema = require('./schema.js'),
    db,
    User;

/** Other dependencies. */
var fs = require('fs');

/** Student database URI. */
app.set('db-uri', 'mongodb://admin:scheme@staff.mongohq.com:10082/cs61as');

/** Model for a User and a LoginToken that will be used for remembering
  * users who have logged in before. */
schema.defineModels(mongoose, function() {
  app.User = User = mongoose.model('User');
  app.LoginToken = LoginToken = mongoose.model('LoginToken');
  db = mongoose.connect(app.set('db-uri'));
});

/** Connect to the database. */
db = mongoose.connect(app.set('db-uri'));

/** Set up server, session management. */
app.use(express.favicon(__dirname + '/public/favicon.ico', { maxAge: 2592000000 })); 
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({
  secret: 'this sucks',
  store: mongoStore(db)
}));
app.use(express.static(__dirname + '/public'));

/** Where to look for templates. */
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

/** Determines if a user is already logged in. */
function loadUser(req, res, next) {
  if (req.session.user_id) {
    User.findById(req.session.user_id, function(err, user) {
      if (!err) {
        req.currentUser = user;
        next();
      } else {
        res.redirect('/home');
      }
    });
  } else {
    res.redirect('/home');
  }
}

/** Default view. */
app.get('/', loadUser, function(req, res){
  res.redirect('/dashboard');
});

/** Default view iff not logged in. */
app.get('/home', function(req, res) {
  res.render('index', { page: 'home', user: new User() });
});

/** Student dashboard. */
// TODO: TA dashboard.
app.get('/dashboard', loadUser, function(req, res) {
  res.render('dashboard', { page: 'dashboard', currentUser: req.currentUser });
});

/** A standard login post request. */
app.post('/login', function(req, res) {
  User.findOne({ username: req.body.user.username }, function(err, user) {
    if (user && user.authenticate(req.body.user.password)) {
      req.session.user_id = user._id;
      res.redirect('/dashboard');
    } else {
      // TODO: Show error
      res.redirect('/home');
    }
  }); 
});

// TODO: logout

/** Start server. */
var port = process.env.PORT || 8084;
app.listen(port);


