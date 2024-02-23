const child_process = require('child_process');

const rendererd = child_process.fork(__dirname + '/rendererd', [parseInt(syzoj.config.renderer_cache_size)]);

const resolver = {};
let currentId = 0;

rendererd.on('message', msg => {
  resolver[msg.id](msg.result);
  delete resolver[msg.id];
});

exports.markdown = (markdownCode, mergeCells, callback) => {
  resolver[++currentId] = callback;
  rendererd.send({
    id: currentId,
    type: 'markdown',
    source: {
      markdownCode,
      mergeCells
    }
  });
}

exports.highlight = (code, lang, callback) => {
  resolver[++currentId] = callback;
  rendererd.send({
    id: currentId,
    type: 'highlight',
    source: {
      code,
      lang
    }
  });
}
