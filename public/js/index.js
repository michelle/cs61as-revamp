$(document).ready(function() {

  /** Dashboard UI. */
  $(function() {
		$( "#accordion" ).accordion({
			collapsible: true
		});
  });
  /** Login form fanciness. */
  $('#showlogin').click(function() {
    $('#showlogin').attr('disabled', 'disabled');
    $('#loginform').slideToggle(500);
    $('#login').fadeToggle('slow');
  });
  /** Superficial things. */
  $(function() {
    $('#home, #alllessons').fadeIn('slow');
    $('#title, #topbar a, #bottombar a, #splash a, #splash button').disableSelection();
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
