// jQuery Input Hints plugin
// Copyright (c) 2009 Rob Volk
// http://www.robvolk.com

jQuery.fn.inputHints=function() {
    // hides the input display text stored in the title on focus
    // and sets it on blur if the user hasn't changed it.

    // show the display text
    $(this).each(function(i) {
        $(this).val($(this).attr('title'))
        .addClass('input_hint');
    });

    // hook up the blur & focus
    return $(this).focus(function() {
        if ($(this).val() == $(this).attr('title'))
            $(this).val('')
        .removeClass('input_hint');
    }).blur(function() {
        if ($(this).val() == '')
            $(this).val($(this).attr('title'))
        .addClass('input_hint');
    });
};

var first_suggest_user = "";
function open_user(id) {
    location.href="user.php?id=" + id;
}
$(function(){
    $("#search_user_bar[title]").inputHints();
    $("#search_user_form").submit(function(){
        if (first_suggest_user) {
            open_user(first_suggest_user);
        }
        return false;
    });

    $("#search_user_bar").autocomplete({
        source: 'json.php?fast&mod=user&func=search_suggest',
        minLength: 2,
        search: function(event, ui) {
            first_suggest_user = "";
        },
        select: function(event, ui) {
            if (ui.item) {
                open_user(ui.item.id);
            } else {
                alert("no");
            }
        },
        focus: function( event, ui ) {
            $( "#search_user_bar" ).val( ui.item.name );
            first_suggest_user = ui.item.id;
            return false;
        }
    }).autocomplete('instance')._renderItem = function( ul, item ) {
        var str = item.name;
        if (item.nickname) {
            str += "(" + item.nickname + ")";
        }
        str +=  "<br>" + item.info;
        if (item.match || !first_suggest_user) {
            str += "<hr />";
            first_suggest_user = item.id;
        }
        return $( "<li></li>" )
        .data( "item.autocomplete", item )
        .append( "<a>" + str + "</a>" )
        .appendTo( ul );
    };
});
