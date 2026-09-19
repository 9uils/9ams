import { useEffect, useState } from 'react';

import { IntlProvider as BaseIntlProvider } from 'react-intl';

import { isProduction } from 'mastodon/utils/environment';

import { getLocale, isLocaleLoaded } from './global_locale';
import { loadLocale } from './load_locale';
import Josa from './josa'; // [수정] Josa import

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

  // [수정] Josa 적용  
  function processJosa(data: any): any {
    if (typeof data === 'string') {
      return Josa.c(data);
    }

    // 배열 처리
    if (Array.isArray(data)) {
      return data.map(processJosa);
    }

    if (data && typeof data === 'object' && !data.$$typeof && data.constructor === Object) {
      const processed: Record<string, any> = {};
      for (const key of Object.keys(data)) {
        processed[key] = processJosa(data[key]);
      }
      return processed;
    }

    return data;
  }

  const josaMessages = useMemo(() => {
    if (locale === 'ko' && messages) {
      try {
        return processJosa(messages);
      } catch (error) {
        console.error('Josa processing crash prevented:', error);
        return messages; // 에러 나면 기존 messages로 원상복구
      }
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
