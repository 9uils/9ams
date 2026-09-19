// https://github.com/e-/Josa.js

function _hasJong(string: string): boolean {
  if (!string || string.length === 0) return false;
  const code = string.charCodeAt(string.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  const jong = (code - 0xac00) % 28;
  return jong > 0;
}

function _hasJongForRo(string: string): boolean {
  if (!string || string.length === 0) return false;
  const code = string.charCodeAt(string.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  const jong = (code - 0xac00) % 28;
  return jong !== 0 && jong !== 8; // 'ㄹ' 받침(8) 제외
}

const _formats: Record<string, (word: string) => string> = {
  '을/를': (w) => (_hasJong(w) ? '을' : '를'),
  '은/는': (w) => (_hasJong(w) ? '은' : '는'),
  '이/가': (w) => (_hasJong(w) ? '이' : '가'),
  '와/과': (w) => (_hasJong(w) ? '과' : '와'),
  '으로/로': (w) => (_hasJongForRo(w) ? '으로' : '로'),
};

const Josa = {
  c: function (sentence: string): string {
    if (typeof sentence !== 'string' || !sentence) return sentence;

    try {
      const regex = /([가-힣0-9a-zA-Z]+)(을\/를|은\/는|이\/가|와\/과|으로\/로)/g;
      return sentence.replace(regex, (match, word, format) => {
        if (!_formats[format]) return match;
        return word + _formats[format](word);
      });
    } catch (e) {
      return sentence;
    }
  },
};

export default Josa;