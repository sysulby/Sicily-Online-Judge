$(() => {
function checkProblemTitle() {
    var pid = $("#pid").val();
    var cid = $("#cid").val();
    if (!cid)
    {
        cid = 0;
    }
    if (pid < 1000)
    {
        $("#problem_title").html("");
        $("#submit_form input:submit").button("disable");
        return false;
    }

    $.post("action.php?act=CheckProblem", 
    {
        "pid": pid, 
        "cid": cid
    }, 
    function(data) {
        $("#problem_title").html("<span id='ptitle'>" + data.status + "</span>");
        var problem_url = "show_problem.php?pid=" + pid;
        if (cid) problem_url += "&cid=" + cid;
        if (data.success)
        {
            $("#submit_form input:submit").button("enable");
            $("#ptitle").wrap("<a href=\""+ problem_url + "\"></a>");
        } else {
            $("#submit_form input:submit").button("disable");
        }
    }, "json");
    return true;
}

var runtimeStatus = ["Judging", "Waiting", "Compiling", "Running"];
var responseTime = 500; // ms
var pbInterval = 100; // ms
var totalTime;
var curCase;
var pbStartTime;
var pbEstTime;
var judgeDone;
var lastInterval;
var pbTimerID;
var editor;
var langName = ["c", "cpp", "pas"];
var langMode = {
    'c': 'c_cpp',
    'cpp': 'c_cpp',
    'pas': 'pascal',
    'java': 'java'
};

function randomTime(time) {
    return Math.floor((Math.random() + 0.5) * time);
}

function showFinalStatus(data) {
    judgeDone = true;
    $("#judge_box").dialog("close");
    setTimeout(function(){
        $("#status_box").dialog("open");
    }, 500);
    stopProgress();

    if (data.status in hintMsg) {
        $("#status_info").text(hintMsg[data.status][0]);
    } else {
        $("#status_info").text(data.status);
    }
    $("#status_more_info").html("");
    if (data.case_num) {
        var casenum = parseInt(data.case_num);
        if (casenum >= 0) {
            if (data.status == "Accepted") {
                $("#status_more_info").append(`<p>Passed all ${casenum} test cases</p>`);
            } else {
                $("#status_more_info").append(`<p>Failed at test case #${casenum + 1}</p>`);
            }
        }
    }
    $("#status_info").removeClass("Accepted Wrong");
    if (data.status == "Accepted") {
        $("#status_info").addClass("Accepted");
        $("#status_more_info")
        .append(`<p>Run Time: ${data.run_time} secs</p>`)
        .append(`<p>Run Memory: ${data.run_memory} KB</p>`);
    } else if (data.status in hintMsg) {
        $("#status_more_info").append(`<p>${hintMsg[data.status][1]}</p>`);
        $("#status_info").addClass("Wrong");
    }
    
    
    $("#tabs").tabs("remove", 1);
    if (data.status == "Compile Error") {
        $.get(`/process.php?act=ViewCE&sid=${data.sid}`, (ceInfo) => {
          $('#status_more_info').append(`<div class="ce-info"><pre>${ceInfo}</pre></div>`);
        });
    }
}

function stopProgress() {
    if (pbTimerID) {
        clearInterval(pbTimerID);
        pbTimerID = null;
    }    
}

function setProgress(percent) {
    percent = Math.floor(percent);
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    $("#progressbar").progressbar("value", percent);
    $("#progressbar_info").text(100 - percent + "% time left.");
}

function checkProgress() {
    var d = new Date();
    var now = d.getTime();
    if (now >= pbEstTime) {
        setProgress(100);
        stopProgress();
    } else {
        if (pbEstTime - pbStartTime == 0) return;
        var percent = (now - pbStartTime) / (pbEstTime - pbStartTime) * 100;
        setProgress(percent);
    }
}

function startProgressBar() {
    var d = new Date();
    pbStartTime = d.getTime() - lastInterval * 0.5;        
    pbEstTime = totalTime * 1000 + pbStartTime;
    pbTimerID = setInterval(checkProgress, pbInterval);
}

// judge is done when return true
function showJudgeStatus(data) {
    $("#judge_info").text(data.status);
    curCase = parseInt(data.case_num);
    if (curCase >= 0) {
        $("#testcase_info").text("Passed " + curCase + "test cases.");
    } else {
        $("#testcase_info").text("Only single test case.");
    }
    if (data.status == runtimeStatus[0] && pbTimerID == null) {
        // startProgressBar();
    }
    
    for (var i = 0; i < runtimeStatus.length; ++i) {
        if (runtimeStatus[i] == data.status) return false;
    }
    return true;
}

function checkStatus(sid) {
    return function() {
        $.post("action.php?act=QueryStatus", {
            "sid": sid
        }, function(data, textstatus){
            if (textstatus != "success") {
                data = {};
                data.success = false;
                data.status = textstatus;
            }
            if (data.success && !showJudgeStatus(data)) {
                var queueSize = parseInt(data.queue_size);
                if (data.status == runtimeStatus[0]) queueSize++;
                if (queueSize == 0 ) queueSize = 1;
                lastInterval = randomTime(responseTime * queueSize);
                setTimeout(checkStatus(sid), lastInterval);
            } else {
                showFinalStatus(data);
            }
        }, "json");
    }
}

function onProblemSubmit(data, textstatus) {
    if (textstatus != "success") {
        data = {};
        data.success = false;
        data.status = textstatus;
    } 
    pbTimerID = null;
    lastInterval = 0;
        
    if (data.success)
    {
        // Start to wait for result
        $("#judge_info").text("Submit succeeded");
        //totalTime = parseInt(data.total_time);
        totalTime = 0;
        checkStatus(data.sid)();
    } else {
        showFinalStatus(data);
    }
}



function problemSubmit() {
    judgeDone = false;
    if ($("#status_box").dialog("isOpen")) {
        $("#status_box").dialog("close");
    }
    $("#judge_box").dialog("open");
    setProgress(0);
    $("#judge_info").text("Submitting your code to server.");
    var pid = $("#pid").val();
    var cid = $("#cid").val();
    var lang = $("#language").val();
    var source = editor.getValue();
    if (!cid) cid = 0; 
    
    $.post("action.php?act=Submit", 
    {
        "pid": pid, 
        "cid": cid, 
        "language": lang, 
        "source":source
    }, 
    onProblemSubmit, "json");
    return false;
}


var judgeDialogSetting = {
    autoOpen: false,
    minWidth: 500,
    resizable: false,
    hide: { effect: 'fade', duration: 200 },
    show: { effect: 'fade', duration: 200 },
    beforeClose: judgeDone
};

var statusDialogSetting = {
    autoOpen: false,
    minHeight: 300,
    minWidth: 500,
    hide: { effect: "fade", duration: 200 },
    show: { effect: "fade", duration: 200 },
    buttons: [
      {
        text: "Back to problem",
        click: function() {
            var cid = $("#cid").val();
            var pid = $("#pid").val();
            if (!cid) cid ="";
            window.location = "show_problem.php?pid="+pid+"&cid="+cid;
        },
      }, {
        text: "Back to problem list",
        click: function() {
            var cid = $("#cid").val(); 
            if (cid) {
                window.location = "contest_detail.php?cid="+cid;
            } else {
                window.location = "problem_list.php";
            }            
        }
      }, {
        text: "OK",
        click: function() {
            $(this).dialog("close");
        }
      }
    ],
    create: function () {
      $(this).closest(".ui-dialog")
        .find(".ui-button")
        .addClass("button_blue");
    }
};

var tabsSetting = {
    cache: true
};

var lang = GetCookie("lang");

function onLanguageChange() {
    lang = parseInt($("select[name=language]").val());
    SetCookie("lang", lang);
    var mode = langMode[langName[lang - 1]];
    editor.getSession().setMode(`ace/mode/${mode}`);
}

function initEditor() {
    ace.config.set("basePath", "js/ace/src-noconflict");
    editor = ace.edit("source");
    editor.setTheme("ace/theme/chrome");
    onLanguageChange();
}

    $("#submit_form input:submit").button();
    $("#pid").change(checkProblemTitle);
    $("#submit_form").submit(problemSubmit);
    $("#status_box").dialog(statusDialogSetting);
    $("#judge_box").dialog(judgeDialogSetting);
    $("#tabs").tabs(tabsSetting);
    $("#progressbar").progressbar({
        value:0
    });
    checkProblemTitle();
    if (lang == null) lang = 2; else lang = parseInt(lang);
    $("select[name=language]").val(lang).change(onLanguageChange);
    initEditor();
});
