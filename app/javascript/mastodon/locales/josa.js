// josa.js

function _hasJong(string) {
  if (!string) return false;
  var code = string.charCodeAt(string.length - 1);
  var jong = (code - 0xac00) % 28;
  return jong > 0;
}

// '으로/로'는 'ㄹ' 받침(종성 번호 8)일 때 '로'가 되는 예외 처리
function _hasJongForRo(string) {
  if (!string) return false;
  var code = string.charCodeAt(string.length - 1);
  var jong = (code - 0xac00) % 28;
  return jong !== 0 && jong !== 8;
}

var _f = [
  function(string) { return _hasJong(string) ? '을' : '를'; },
  function(string) { return _hasJong(string) ? '은' : '는'; },
  function(string) { return _hasJong(string) ? '이' : '가'; },
  function(string) { return _hasJong(string) ? '과' : '와'; },
  function(string) { return _hasJongForRo(string) ? '으로' : '로'; }
];

var _formats = {
  '을/를': _f[0],
  '은/는': _f[1],
  '이/가': _f[2],
  '와/과': _f[3],
  '으로/로': _f[4]
};

var josa = {
  c: function(sentence) {
    if (typeof sentence !== 'string') return sentence;
    var regex = /([가-힣0-9a-zA-Z]+)(을\/를|은\/는|이\/가|와\/과|으로\/로)/g;

    return sentence.replace(regex, function(match, word, format) {
      if (typeof _formats[format] === 'undefined') return match;
      return word + _formats[format](word);
    });
  },
  r: function(word, format) {
    return word + (this.c(word + format) || '');
  }
};

export default josa;