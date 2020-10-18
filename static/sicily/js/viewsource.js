function onClickShareLink(data) {
	if (data.success) {
		$("#public").text("Code has been published. Just copy the URL to your friend!");
	} else {
		$("#public").text(data.status);
	}
}

var langMode = {
    'c': 'c_cpp',
    'cpp': 'c_cpp',
    'pas': 'pascal',
    'java': 'java'
};
function initEditor() {
    ace.config.set("basePath", "js/ace/src-noconflict");
    editor = ace.edit("source");
    editor.setTheme("ace/theme/chrome");
    editor.setReadOnly(true);
    editor.setOptions({
        maxLines: 300
    });
    mode = langMode[lang];
    editor.getSession().setMode('ace/mode/' + mode);
}

$(document).ready(function() {
	$("#share_link").click(function() {
		$.post("action.php?act=PublishCode", {
			"sid":sid
		}, onClickShareLink, "json");
		return false;
	});
	if (!owner) {
		$("#public").hide();
	}
    initEditor();
});

