function getUrlParam(name)
{
  var reg = new RegExp("(^|&)"+ name +"=([^&]*)(&|$)"); 
  var r = window.location.search.substr(1).match(reg); 
  if (r!=null) return unescape(r[2]); return null;
}

function prompt_login() {
	alert("Please log in first");
	$("#username").focus();
}

function toggle_reply(id) {
	if (!logged) {
		prompt_login();
		return;
	}
	$('#reply_' + id).toggle();
	$('#edit_' + id).focus();
	$('html, body').animate({ scrollTop: $("#edit_"+id).offset().top - 300}, 500);
}

function toggle_new_post() {
	if (!logged) {
		prompt_login();
		return;
	}
	$('#banner').toggle();
	$('#banner_extend').toggle();
	$('#new_title').focus();
	$('html, body').animate({ scrollTop: $("#new_post").offset().top -300}, 500);
}

function escape_special_html(str) {
	return $('<div/>').text(str).html();
}

function display_reply(id, reply, anchor) {
	var display_author = reply.name;
	if (reply.nickname) display_author += "(" + reply.nickname + ")";
	display_author = "<a href='user.php?id=" + reply.user_id + "' class='hord_link'>"
		+ escape_special_html(display_author)
		+ "</a>";
	
	$("#reply_template")
	.clone()
	.show()
	.prependTo(anchor + id)
	.find('.post_header').html(display_author 
		+ "<div class='addition_info'> - " 
		+ reply.create_time +"</div>")
	.end()
	.find('.post_body').text(reply.content);        
}

function fetch_more_reply(id, start) {
	$.post("json.php?mod=clarification&func=more_replies", {'id':id, 'start':start}, function(data){
		var num_replies = 0;
		for (var index in data) {
			++num_replies;
			display_reply(id, data[index], "#more_reply_anchor_");
		}
		$("#more_reply_" + id).hide();
	}, 'json');
} 

function reply_post(id) {
	var content = $("#edit_" + id).val();
	$("#edit_" + id).val("");
	toggle_reply(id);
	$.post("json.php?mod=clarification&func=reply_clarification", {'id':id, 'content':content}, 
	function(data){
		if (typeof(data)=='number') {
			$.post('json.php?mod=clarification&func=get_clarification', {'id':data}, function(post){
				display_reply(id, post, "#reply_anchor_");
			}, 'json');                
		} else if (typeof(data) == 'string') {
			alert(data);
		} else {
			alert("An error has occured.");
		}
	}, 'json');
}

function new_question() {
  var cid = getUrlParam('cid');
	toggle_new_post();
	$.post("json.php?mod=clarification&func=new_clarification",
	{   'catalog': 'question',  
    'object': $("#new_post_catalog").val(), 
		'title': $("#new_title").val(), 
		'content': $("#new_edit").val(), 
		'contest': cid
	},
	function(data){
		if (typeof(data)=='number') {
			location.reload();
		} else if (typeof(data) == 'string') {
			alert(data);
		} else {
			alert("An error has occured.");
		}
	}, 'json');
}

function new_answer() {
  var cid = getUrlParam('cid');
	toggle_new_post();
	$.post("json.php?mod=clarification&func=new_clarification",
	{   'catalog': 'clarification',  
    'object': $("#new_post_catalog").val(), 
		'title': $("#new_title").val(), 
		'content': $("#new_edit").val(), 
		'contest': cid
	},
	function(data){
		if (typeof(data)=='number') {
			location.reload();
		} else if (typeof(data) == 'string') {
			alert(data);
		} else {
			alert("An error has occured.");
		}
	}, 'json');
}

$(function(){
	function insertStr(obj, str) {
		var start = obj.selectionStart;
		var len = str.length;
		obj.value = obj.value.substring(0, start) 
			+ str
			+ obj.value.substring(start, obj.value.length);
		obj.selectionStart = start + len;
		obj.selectionEnd = start + len;			
	}
	
	function smartIndent(obj) {
		var start = obj.selectionStart;
		var indentCount = 0;
		var i;
		for (i = start-1; i >= 0; --i) {
			var ch = obj.value.charAt(i);
			if (ch === '\n') {
				break;
			} else if (ch === ' ') {
				indentCount++;
			} else {
				indentCount = 0;
			}
		}
		if (indentCount > 0) {
			var dup = [];
			for (i = 0; i < indentCount; ++i) {
				dup.push(' ');
			}
			insertStr(obj, "\n" + dup.join(""));
		} else {
			insertStr(obj, "\n");
		}
	}
	
	function replaceTab(obj) {
		obj.value = obj.value.split("\t").join("    ");
	}
	
	function adjustRowsNum(obj) {
		var lineCount = obj.value.split("\n").length;
		if (lineCount >= 5) {
			obj.rows = lineCount + 1;
		} else {
			obj.rows = 6;
		}			
	}
	$("textarea").keydown(function(e){
		var obj = e.target;
		if (e.keyCode === 9) {
			// Pressed [Tab] key
			insertStr(obj, "    ");
			return false;
		} else if (e.keyCode === 13) {
			// Pressed [Enter] key
			smartIndent(obj);
			return false;
		}
	}).change(function(e){
		replaceTab(e.target);
		adjustRowsNum(e.target);			
	}).keyup(function(e){
		replaceTab(e.target);
		adjustRowsNum(e.target);
	});
});
