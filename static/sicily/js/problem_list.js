$(function() {
  tabDisplayText = tabDisplayText ? tabDisplayText : {
    lengthMenu: "Display _MENU_ problems per page",
    zeroRecords: "No Problems are matched",
    info: "Showing _START_ to _END_ of _TOTAL_ problems",
    infoEmtpy: "No problems are showed",
    infoFiltered: "(filtered from _MAX_ total problems)",
    errorLoading: "Couldn't load this problem. We'll try to fix this as soon as possible."
  };
  $( "#tabs" ).tabs({
    cookie: {
      expires: 7
    },
    ajaxOptions: {
      error: function( xhr, status, index, anchor ) {
        $( anchor.hash ).html(
          tabDisplayText.sErrorLoading);
      }
    },
    load: function(e, ui) {
      $.fn.dataTable.ext.pager.numbers_length = 8;
      var advtable_fix = $(ui.panel).find(".advtable_fix").dataTable({
        pagingType: "full_numbers",
        order: [[ 1, "asc" ]],
        stateSave: true,
        language: tabDisplayText, 
        displayLength: 100,
        jQueryUI: true, 
        columns: [
        { 
          render: function (data) {
            if (data === 'Y') {
              return "<img class='yes' src='images/yes.gif' />"
            } else if (data === '-') {
              return "<img class='no' src='images/not_yet.gif' />"
            } else return "";
          },
          useRendered: false, 
          searchable: false,
          className: "place_center",
          width: "10%"
        },
        {
          className: "place_center", 
          width: "8%"
        },
        { 
          render: function (data, type, row, meta) {
            return '<a class="black" href="' + row[1] + '">' + data + '</a>';
          },
          className: "place_left", 
          useRendered: false,
          width: "40%"
        },
        { 
          searchable: false,
          fnRender: function ( oObj ) {
            return "<a class='black' href='problem_status.php?pid=" + oObj.aData[1] + "'>"
            + oObj.aData[3] + "</a>"
          },
          className: "place_center",
          useRendered: false
        },
        {
          searchable: false, 
          className: "place_center"
        },
        { 
          searchable: false, 
          className: "place_center",
          useRendered: false,
          fnRender: function ( oObj ) {
            return oObj.aData[5] + "%";
          }
        }
        ]
      });
    }
  });
});
