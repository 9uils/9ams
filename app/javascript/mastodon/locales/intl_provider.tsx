import { useEffect, useState } from 'react';

import { IntlProvider as BaseIntlProvider } from 'react-intl';

import { isProduction } from 'mastodon/utils/environment';

import { getLocale, isLocaleLoaded } from './global_locale';
import { loadLocale } from './load_locale';
import Josa from './josa';

function onProviderError(error: unknown) {
  // Silent the error, like upstream does
  if (isProduction()) return;

  // This browser does not advertise Intl support for this locale, we only print a warning
  // As-per the spec, the browser should select the best matching locale
  if (
    error &&
    typeof error === 'object' &&
    error instanceof Error &&
    /MISSING_DATA/.exec(error.message)
  ) {
    console.warn(error.message);
  }

  console.error(error);
}

export const IntlProvider: React.FC<
  Omit<React.ComponentProps<typeof BaseIntlProvider>, 'locale' | 'messages'>
> = ({ children, ...props }) => {
  const [localeLoaded, setLocaleLoaded] = useState(false);

  useEffect(() => {
    async function loadLocaleData() {
      if (!isLocaleLoaded()) {
        await loadLocale();
      }

      setLocaleLoaded(true);
    }
    void loadLocaleData();
  }, []);

  if (!localeLoaded) return null;

  const { locale, messages } = getLocale();

  // 한국어('ko')일 경우 messages 내부의 모든 조사 문구를 Josa.c()로 사전 변환/가공
  const josaMessages = useMemo(() => {
    if (locale === 'ko' && messages) {
      const processed: Record<string, string> = {};
      for (const [key, value] of Object.entries(messages)) {
        processed[key] = typeof value === 'string' ? Josa.c(value) : value;
      }
      return processed;
    }
    return messages;
  }, [locale, messages]);

  return (
    <BaseIntlProvider
      locale={locale}
      messages={josaMessages}
      onError={onProviderError}
      textComponent='span'
      {...props}
    >
      {children}
    </BaseIntlProvider>
  );
};
