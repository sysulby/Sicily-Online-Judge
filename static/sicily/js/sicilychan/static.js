function showSicilyChan(msg){
	$("body").append(`
        <div id="sicily_chan">
            <div id="talkbox">
                <div id="boxtop"></div>
                <div id="boxcnt">${msg}</div>
                <div id="boxbottom"></div>
            </div>
            <div id="sicilychan_body">
                <div id="face" class="face1"></div>
            </div>
        </div>
    `);

	$("#sicily_chan").draggable();
    var p;
    (p = () => new Promise((resolve) => {
        setTimeout(() => {
            $("#face").removeClass("face1").addClass("face2");
            resolve();
        }, 2000 + Math.random() * 2000);
    }).then(() => new Promise((resolve) => {
        setTimeout(() => {
            $("#face").removeClass("face2").addClass("face3");
            resolve();
        }, 100);
    })).then(() => new Promise((resolve) => {
        setTimeout(() => {
            $("#face").removeClass("face3").addClass("face1");
            resolve();
        }, 100);
    }).then(p)))();
};
