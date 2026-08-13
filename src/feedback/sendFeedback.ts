import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';

const FEEDBACK_EMAIL = 'appcenter.support@gmail.com';
const FEEDBACK_SUBJECT = 'Voice Memos Plus Feedback';

function buildFeedbackBody(): string {
  const version = Constants.expoConfig?.version ?? 'unknown';
  return [
    'Please share your experience and/or feedback. Attach screenshots when applicable.',
    '',
    '—',
    `App version: ${version}`,
  ].join('\n');
}

export async function sendFeedbackEmail(): Promise<void> {
  const url =
    `mailto:${FEEDBACK_EMAIL}` +
    `?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}` +
    `&body=${encodeURIComponent(buildFeedbackBody())}`;

  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to Send Feedback', 'No email app is available on this device.');
  }
}
