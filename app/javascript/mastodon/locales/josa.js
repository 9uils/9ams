(function(){
  var	_f = [
    function(string) { //을/를 구분
      return _hasJong(string) ? '을' : '를';
    },
    function(string){ //은/는 구분
      return _hasJong(string) ? '은' : '는';
    },
    function(string){ //이/가 구분
      return _hasJong(string) ? '이' : '가';
    },
    function(string){ //와/과 구분
      return _hasJong(string) ? '과' : '와';
    },
    function(string){ //으로/로 구분
      return _hasJong(string) ? '으로' : '로';
    }
  ],
    _formats = {
      '을/를' : _f[0],
      '은/는' : _f[1],
      '이/가' : _f[2],
      '와/과' : _f[3],
      '으로/로' : _f[4]
    };

  function _hasJong(string){ //string의 마지막 글자가 받침을 가지는지 확인
    string = string.charCodeAt(string.length - 1);
    return (string - 0xac00) % 28 > 0;
  }

  var josa = {
    c: function(sentence){
      if (typeof sentence !== 'string') return sentence;
      var regex = /([가-힣0-9a-zA-Z]+)(을\/를|은\/는|이\/가|와\/과|으로\/로)/g;

      return sentence.replace(regex, function(match, word, format) {
        if (typeof _formats[format] === 'undefined') return match;
        return word + _formats[format](word);
      });
    },
    r: function(word, format) {
      return word + (this.c(word, format) || '');
    }
  };

  if (typeof define == 'function' && define.amd) {
    define(function(){
      return josa;
    });
  } else if (typeof module !== 'undefined') {
    module.exports = josa;
  } else {
    window.Josa = josa;
  }
})();