$(document).ready(
  function() {
	  $('#showlogin').click(
	    function() {
	      $('#showlogin').attr('disabled', 'disabled');
	      $('#loginform').slideToggle(300);
	      $('#showlogin').fadeToggle(300);
	    }
	  );
  }
);