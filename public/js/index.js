$(document).ready(function() {
  var hidden = false;
    if ($('#signal').position().left < 150 && !hidden) {
      $('#topbar .up').hide();
      hidden = true;
    }
    if ($(document).height() <= $(window).height() + 150) {
      $('#bottombar, #push').hide();
    }
  /** Dashboard UI. */
  $(function() {
    $( "#accordion" ).accordion({
			collapsible: true
		});
    $("#solution").accordion({
      collapsible: true,
      active: false
    });
  });
  /** Window resizing. */
  $(window).resize(function() {
    if ($('#signal').position().left < 150 && !hidden) {
      $('#topbar .up').hide();
      hidden = true;
    }
    if ($('#signal').position().left > 500 && hidden) {
      $('#topbar .up').show();
      hidden = false;
    }
    if ($(document).height() > $(window).height() + 200) {
      $('#bottombar').show();
    }
    if ($(document).height() <= $(window).height() + 200) {
      $('#bottombar').hide();
    }
  });
  /** Smooth scrolling. */
  $(".scroll").click(function(event) {
    event.preventDefault();

    var full_url = this.href;

    var parts = full_url.split("#");
    var trgt = parts[1];

    var target_offset = $("#" + trgt).offset();
    var target_top = target_offset.top;

    $('html, body').animate({
      scrollTop: target_top
    }, 500);
  });
  /** Hidden Lambda. */
  $('#title').click(function() {
    $(this).html('CS61<span id="lambda">λ</span>S');
  });
});
