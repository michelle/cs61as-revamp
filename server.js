/** debug flags. */
var DEBUG = true;

/** Setting up dependencies. */
var express = require('express');
var app = module.exports = express.createServer();
var mongoose = require('mongoose');
var mongoStore = require('connect-mongodb');
var schema = require('./schema.js');
var fs = require('fs');

/** Database. */
var db;
var GUEST;

/** Flash message support. */
app.helpers(require('./dh.js').helpers);
app.dynamicHelpers(require('./dh.js').dynamicHelpers);

/** Student database URI. */
app.set('db-uri', 'mongodb://admin:scheme@staff.mongohq.com:10082/cs61as');

/** Model for a User and a LoginToken that will be used for remembering
  * users who have logged in before. */
schema.defineModels(mongoose, function() {
  app.User = User = mongoose.model('User');
  app.Video = Video = mongoose.model('Video');
  app.Reading = Reading = mongoose.model('Reading');
  app.Assignment = Assignment = mongoose.model('Assignment');
  app.Lesson = Lesson = mongoose.model('Lesson');
  app.LoginToken = LoginToken = mongoose.model('LoginToken');
  app.Grade = Grade = mongoose.model('Grade');
  db = mongoose.connect(app.set('db-uri'));
});

/** Default guest user. */
GUEST = new User({
  username: 'Guest',
  permission: schema.permissions.Guest
});

/** Set up server, session management. */
app.use(express.favicon(__dirname + '/public/favicon.ico', { maxAge: 2592000000 })); 
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({ secret: 'this sucks', store: mongoStore(db) }));
app.use(express.static(__dirname + '/public'));

/** Where to look for templates. */
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

/** Set current user and lesson if logged in.
 *  Set current user to GUEST and redirect to /home if not logged in.
 *  Redirect to /home if err. */
function loadUser(req, res, next) {
  req.currentUser = GUEST;

  if (req.session.user_id) {
    User.findById(req.session.user_id, function(err, user) {
      if (err) {
        if (DEBUG) console.log('WARNING: session is in incorrect state: %s', req.session);
        if (DEBUG) console.log(err);
        res.redirect('/home');
      }

      req.currentUser = user;
      Lesson.findOne({ number: user.progress }, function(err, lesson) {
        if (err) {
          if (DEBUG) console.log("WARNING: User %s's progress is corrupted", user.progress);
          if (DEBUG) console.log(err);
          req.flash('error', 'Looks like there is something wrong with your account. Please see an administrator.');
          res.redirect('/home');
        }

        req.currentLesson = lesson;
        next();
      });
    });
  } else {
    res.redirect('/home');
  }
}

/** Make a middleware that only allows user with a PERMIT. */
function checkPermit(permit) {
  return function(req, res, next) {
    if (req.currentUser[permit]()) {
      next();
    } else {
      req.flash('error', "Looks like You don't have the permission to access this page.");
      res.redirect('/home');
    }
  }
}

/** Default view iff logged in. */
app.get('/', loadUser, function(req, res){
  res.redirect('/dashboard');
});

/** Default view iff not logged in. */
app.get('/home', function(req, res) {
  // TODO: change this to accept currentUser (or GUEST)
  res.render('index', { page: 'home', user: new User() });
});

/** Student dashboard. */
app.get('/dashboard', loadUser, checkPermit('canAccessDashboard'), function(req, res) {
  res.render('dashboard', { page: 'dashboard', currentUser: req.currentUser, currentLesson: req.currentLesson });
});

/** Webcast viewing. */
app.get('/webcast', loadUser, checkPermit('canReadLesson'), function(req, res) {
  Lesson.findOne({ number: req.currentUser.progress }, function(err, lesson) {
    if (!err) {
      res.render('video', { page: 'webcast', currentUser: req.currentUser, currentLesson: req.currentLesson, vids: lesson.videos });
    } else {
      if (DEBUG && err) console.log(err);
      req.flash('error', 'Whoops! This video does not exist.');
      res.redirect('/dashboard');
    }
  });
});

/** Viewing previously completed webcasts. */
app.get('/webcast/:number', loadUser, checkPermit('canReadLesson'), function(req, res) {
  if (req.currentUser.progress < req.params.number) {
    req.flash('error', 'You have not gotten this far yet!');
    res.redirect('/webcast');
  } else {
    Lesson.findOne({ number: req.params.number }, function(err, lesson) {
      if (!err) {
        res.render('video', { page: 'webcast', currentUser: req.currentUser, currentLesson: req.currentLesson, vids: lesson.videos });
      } else {
        if (DEBUG && err) console.log(err);
        req.flash('error', 'Whoops! This video does not exist.');
        res.redirect('/webcast');
      }
    });
  }
});

/** Viewing user profiles. */
app.get('/user/:username', loadUser, checkPermit('canReadUserInfoEveryone'), function(req, res) {
  res.render('profile', { page: 'profile', currentUser: req.currentUser, grades: req.currentUser.canReadGradeEveryone(), viewing: req.currentUser.username });
});

/** Settings page. */
// TODO: Allow users to change their unit preferences, password, email, etc (maybe profile options if time).
app.get('/settings', loadUser, function(req, res) {
  res.render('settings', { page: 'settings', currentUser: req.currentUser });
});

/** Announcements. */
// TODO: Integrate Wordpress to post updates.
app.get('/blog', loadUser, function(req, res) {

});

/** Administration. */
// TODO: Compile administrative documents onto a static page.
app.get('/administration', loadUser, function(req, res) {
  res.render('administration', { page: 'administration', currentUser: req.currentUser });
});

/** Admin Control Panel. */
app.get('/admin', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  res.render('admin', { page: 'admin/index', currentUser: req.currentUser });
});

/** Manage users. */
app.get('/admin/users', loadUser, function(req, res) {
  User.find({}, function(err, users) {
    if (DEBUG && err) console.log(err);
    res.render('admin/users', { page: 'admin/users/index', currentUser: req.currentUser, users : users });
  });
});

/** Add an user. */
app.post('/admin/users/add', loadUser, function(req, res) {
  var user = new User({
    username: req.body.user.username,
    email: req.body.user.email,
  });
  user.password = req.body.user.password;
  user.save(function(err) {
    if (DEBUG && err) console.log(err);
  });
  User.find({}, function(err, users) {
    if (DEBUG && err) console.log(err);
    res.render('admin/users', { page: 'admin/users/index', currentUser: req.currentUser, users : users });
  });
});

/** Edit an user. */
app.get('/admin/users/edit/:userID', loadUser, function(req, res) {
  User.findById(req.params.userID, function(err, user) {
    if (DEBUG && err) console.log(err);
    res.render('admin/users/edit', { page: 'admin/users/edit', currentUser: req.currentUser, user : user });
  });
});

/** Save edit an user. */
app.post('/admin/users/edit/:userID', loadUser, function(req, res) {
  User.findById(req.params.userID, function(err, user) {
    if (DEBUG && err) console.log(err);
    user.username = req.body.user.username;
    user.email = req.body.user.email;
    user.password = req.body.user.password;
    user.permission = req.body.user.permission;
    user.save();
    res.render('admin/users/edit', { page: 'admin/users/edit', currentUser: req.currentUser, user : user });
  });
});

/** A standard login post request. */
app.post('/login', function(req, res) {
  User.findOne({ username: req.body.user.username }, function(err, user) {
    if (DEBUG && err) console.log(err);
    if (user && user.authenticate(req.body.user.password)) {
      req.session.user_id = user._id;
      res.redirect('/dashboard');
    } else {
      req.flash('error', 'Invalid username or password.');
      res.redirect('/home');
    }
  }); 
});

/** Guest login. */
// TODO: Make better?
app.get('/guest', function(req, res) {
  res.redirect('/lessons');
});

/** Logging out. */
app.get('/logout', loadUser, function(req, res) {
  if (req.session) {
    // LoginToken.remove({ username: req.currentUser.username }, function() {});
    //res.clearCookie('logintoken');
    req.flash('info', 'Logged out successfully!');
    req.session.destroy(function() {});
  }
  // How to get flash to work if session is destroyed?
  res.redirect('/home');
});

/** Collective lessons. */
app.get('/lessons', loadUser, function(req, res) {
  Lesson.find({}, function(err, lessons) {
    if (DEBUG && err) console.log(err);
    res.render('lessons', { page: 'lessons', currentUser: req.currentUser, lessons: lessons });
  });
});

/** Homework. */
app.get('/homework/:number', loadUser, function(req, res) {
  var num = req.params.number;
  res.render('homework', { page: 'homework', currentUser: req.currentUser, currentLesson: req.currentLesson });
});

/** Redirect everything else back to dashboard if logged in. */
app.get('*', function(req, res) {
  req.flash('error', "Whoops! The url you just went to does not exist.");
  res.redirect('/');
});



// TODO: Search function



/** Start server. */
var port = process.env.PORT || 8084;
app.listen(port);


