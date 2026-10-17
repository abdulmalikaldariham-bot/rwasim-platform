import { redirect } from 'next/navigation';
import { homeFor, requireSession } from '@/lib/auth';

export default async function Home() {
  const { profile } = await requireSession();
  redirect(homeFor(profile.role));
}
