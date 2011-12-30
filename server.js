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
  app.Video = Video = mongoose.model('Video');
  app.Reading = Reading = mongoose.model('Reading');
  app.Assignment = Assignment = mongoose.model('Assignment');
  app.Lesson = Lesson = mongoose.model('Lesson');
  app.LoginToken = LoginToken = mongoose.model('LoginToken');
  app.Grade = Grade = mongoose.model('Grade');
  db = mongoose.connect(app.set('db-uri'));
});

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
        Lesson.findOne({ number: user.progress }, function(err, lesson) {
          if (!err) {
            req.currentLesson = lesson;
            next();
          } else {
            // TODO: Worry about this.
            res.redirect('/home');
          }
        });
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
  res.render('dashboard', { page: 'dashboard', currentUser: req.currentUser, currentLesson: req.currentLesson });
});

/** Webcast viewing. */
app.get('/webcast', loadUser, function(req, res) {
  var num = req.currentUser.progress;
  var vids = [];
  Lesson.findOne({ number: num }, function(err, lesson) {
    if (!err) {
      vids = lesson.videos;
      res.render('video', { page: 'webcast', currentUser: req.currentUser, currentLesson: req.currentLesson, vids: vids });
    } else {
      // TODO: Worry about errors.
    }
  });
  
});

/** Viewing previously completed webcasts. */
app.get('/webcast/:number', loadUser, function(req, res) {
  var num = req.params.number;
  var vids = [];
  if (req.currentUser.progress < num) {
    res.redirect('/webcast');
  } else {
    Lesson.findOne({ number: num }, function(err, lesson) {
      if (!err) {
        vids = lesson.videos;
        res.render('video', { page: 'webcast', currentUser: req.currentUser, currentLesson: req.currentLesson, vids: vids });
      } else {
        res.redirect('/webcast');
      }
    });
  }
});

/** Viewing user profiles. */
// TODO: Decide if we should actually allow users to view others' profiles, and if so, what to include.
app.get('/user/:username', loadUser, function(req, res) {
  var username = req.params.username;
  var grades = false;
  if (req.currentUser.username === username) {
    grades = true;
  }
  res.render('profile', { page: 'profile', currentUser: req.currentUser, grades: grades, viewing: username });
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
// HACK: check permission
app.get('/admin', loadUser, function(req, res) {
  res.render('admin', { page: 'admin/index', currentUser: req.currentUser });
});

/** Manage users. */
app.get('/admin/users', loadUser, function(req, res) {
  User.find({}, function(err, users) {
    res.render('admin/users', { page: 'admin/users/index', currentUser: req.currentUser, users : users });
  });
});

/** Add an user. */
app.post('/admin/users/add', loadUser, function(req, res) {
  var user = new User({
    username: req.body.user.username,
    email: req.body.user.email,
    grades: [],
    progress: "1"
  });
  user.password = req.body.user.password;
  user.save();
  User.find({}, function(err, users) {
    res.render('admin/users', { page: 'admin/users/index', currentUser: req.currentUser, users : users });
  });
});

/** Edit an user. */
app.get('/admin/users/edit/:userID', loadUser, function(req, res) {
  User.findById(req.params.userID, function(err, user) {
    res.render('admin/users/edit', { page: 'admin/users/edit', currentUser: req.currentUser, user : user });
  });
});

/** Save edit an user. */
// TODO: implement
app.post('/admin/users/edit/:userID', loadUser, function(req, res) {
  User.findById(req.params.userID, function(err, user) {
    user.username = req.body.user.username;
    user.email = req.body.user.email;
    user.password = req.body.user.password;
    user.save();
    res.render('admin/users/edit', { page: 'admin/users/edit', currentUser: req.currentUser, user : user });
  });
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
// TODO: Search function

/** Start server. */
var port = process.env.PORT || 8084;
app.listen(port);


