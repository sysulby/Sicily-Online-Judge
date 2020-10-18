$(() => {
  $('.advtable_fix').dataTable({
		processing: true,
		order: [[ 1, 'asc' ]],
		language: {
			lengthMenu: 'Display _MENU_ problems per page',
			zeroRecords: 'No Problems are matched',
			info: 'Showing _START_ to _END_ of _TOTAL_ problems',
			infoEmtpy: 'No problems are showed',
			infoFiltered: '(filtered from _MAX_ total problems)'
		}, 
    displayLength: 25,
    jQueryUI: true, 
		columns: [{ 
	  		searchable: false,
		  	class: 'place_center',
			  width: '10%'
  		}, {
		  	class: 'place_center',
			  width: '10%'
  		}, { 
			  class: 'place_left'
  		}, {
		  	searchable: false, 
			  class: 'place_center',
  			width: '15%'
	  	}, {
			  searchable: false, 
  			class: 'place_center',
	  		width: '15%'
		}]
	});
});	
