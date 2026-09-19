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

  // Josa 적용
  function processJosa(target: any): any {
    if (typeof target === 'string') {
      return Josa.c(target);
    }
    if (typeof target === 'object' && target !== null) {
      const result: Record<string, any> = Array.isArray(target) ? [] : {};
      for (const key of Object.keys(target)) {
        result[key] = processJosa(target[key]);
      }
      return result;
    }
    return target;
  }

  const josaMessages = useMemo(() => {
    if (locale === 'ko' && messages) {
      return processJosa(messages);
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
