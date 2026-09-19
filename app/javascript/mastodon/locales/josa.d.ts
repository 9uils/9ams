// josa.d.ts
declare interface Josa {
  c(sentence: string): string;
  r(word: string, format: string): string;
}

declare const josa: Josa;
export default josa;