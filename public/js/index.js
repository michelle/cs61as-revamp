$(document).ready(function(){

  /** Login form fanciness. */
	$('#showlogin').click(function(){
	  $('#showlogin').attr('disabled', 'disabled');
	  $('#loginform').slideToggle(500);
	  $('#showlogin').fadeToggle(300);
	});
	
	/** Smooth scrolling. */
	$(".scroll").click(function(event){
    event.preventDefault();
 
    var full_url = this.href;
 
    var parts = full_url.split("#");
    var trgt = parts[1];
 
    var target_offset = $("#"+trgt).offset();
    var target_top = target_offset.top;
 
    $('html, body').animate({scrollTop:target_top}, 500);
  });
  
  /** Hidden Lambda. */
  $('#title').click(function() {
    $(this).html('CS61<span id="lambda">λ</span>S');
  });
});