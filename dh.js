exports.helpers = {
  appName: 'CS61AS',
  version: '0.1',

  nameAndVersion: function(name, version) {
    return name + ' v' + version;
  }
};

/** Represents a flash message. */
function FlashMessage(type, messages) {
  this.type = type;
  this.messages = typeof messages === 'string' ? [messages] : messages;
}

/** Decide how to print flash messages. */
FlashMessage.prototype = {
  get icon() {
    switch (this.type) {
      case 'info':
        return 'comment';
      case 'error':
        return 'denied';
    }
  },

  get stateClass() {
    switch (this.type) {
      case 'info':
        return 'infonote';
      case 'error':
        return 'errornote';
    }
  },

  toHTML: function() {
    return '<div class="flash">' +
           '<div class="' + this.stateClass + ' ui-corner-all">' +
           '<div class="padding"><span class="iconic ' + this.icon + '"></span>' + this.messages.join(', ') + '</div>' +
           '</div>' +
           '</div>';
  }
};

/** Organize flash messages. */
exports.dynamicHelpers = {
  flashMessages: function(req, res) {
    var html = '';
    ['error', 'info'].forEach(function(type) {
      var messages = req.flash(type);
      if (messages.length > 0) {
        html += new FlashMessage(type, messages).toHTML();
      }
    });
    return html;
  }
};