$(document).ready(function() {

  /** Dashboard UI. */
  $(function() {
    $("#sortable, #sortable2, #sortable3").sortable({
      placeholder: "ui-state-highlight",
      items: "li:not(.ui-state-completed)"
    });
    $("#sortable li, #sortable2 li, #sortable3 li").disableSelection();
  });
  /** Login form fanciness. */
  $('#showlogin').click(function() {
    $('#showlogin').attr('disabled', 'disabled');
    $('#loginform').slideToggle(500);
    $('#login').fadeToggle('slow');
  });
  /** Superficial things. */
  $(function() {
    $('#home').fadeIn('slow');
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
