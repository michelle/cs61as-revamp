$(document).ready(function() {
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
  /** Superficial things. */
  $(function() {
    topbarwidth = $('#topfloater').width();
    if ($('#topfloater').width() > .96*$(window).width()) {
      $('#topbar .up').hide();
    }
    if ($(document).height() <= $(window).height() + 200) {
      $('#bottombar').hide();
    }
    $('#title, #topbar a, #bottombar a, #splash a, #splash button').disableSelection();
  });
  /** Window resizing. */
  $(window).resize(function() {
    if (topbarwidth > .96*$(window).width()) {
      $('#topbar .up').hide();
    }
    if (topbarwidth <= .96*$(window).width()) {
      $('#topbar .up').show();
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
