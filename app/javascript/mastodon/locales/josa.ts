// app/javascript/mastodon/locales/josa.ts

function _hasJong(string: string): boolean {
  if (!string) return false;
  const code = string.charCodeAt(string.length - 1);
  const jong = (code - 0xac00) % 28;
  return jong > 0;
}

function _hasJongForRo(string: string): boolean {
  if (!string) return false;
  const code = string.charCodeAt(string.length - 1);
  const jong = (code - 0xac00) % 28;
  return jong !== 0 && jong !== 8;
}

const _f = [
  (string: string) => (_hasJong(string) ? '을' : '를'),
  (string: string) => (_hasJong(string) ? '은' : '는'),
  (string: string) => (_hasJong(string) ? '이' : '가'),
  (string: string) => (_hasJong(string) ? '과' : '와'),
  (string: string) => (_hasJongForRo(string) ? '으로' : '로'),
];

const _formats: Record<string, (word: string) => string> = {
  '을/를': _f[0],
  '은/는': _f[1],
  '이/가': _f[2],
  '와/과': _f[3],
  '으로/로': _f[4],
};

const Josa = {
  c: function (sentence: string): string {
    if (typeof sentence !== 'string') return sentence;
    const regex = /([가-힣0-9a-zA-Z]+)(을\/를|은\/는|이\/가|와\/과|으로\/로)/g;

    return sentence.replace(regex, (match, word, format) => {
      if (typeof _formats[format] === 'undefined') return match;
      return word + _formats[format](word);
    });
  },
  r: function (word: string, format: string): string {
    return word + (this.c(word + format) || '');
  },
};

export default Josa;