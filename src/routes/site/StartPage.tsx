/**
 * /start: "Start here" for new players (2.0, 2026-10-09). Five steps from "I want a tag" to talking trash on the
 * Board. Copy only; every rule here mirrors the database (tag swaps, challenges, Early Access) and lib/td/help.ts.
 */
import { Link } from 'react-router-dom';
import { CLUB } from '../../lib/jewel/content';
import { Button, SectionHeading } from '../../components/ui';
import './start.css';

interface Step { n: number; kick: string; title: string; body: string[]; tip?: string }

const STEPS: Step[] = [
  {
    n: 1, kick: 'Get in', title: 'Get a tag and your My Tag link',
    body: [
      'Ask your league TD (or the Facebook group) for a tag in your league\'s set. You get the next number at the bottom. Earn your way up.',
      'The TD sends you a private My Tag link. That link IS you: your tags, your challenges, your rounds. Don\'t share it.',
    ],
    tip: 'Lost your link? Your league TD can send a new one in a few seconds.',
  },
  {
    n: 2, kick: 'Set up your phone', title: 'Put it on your home screen and turn on alerts',
    body: [
      'Open your My Tag link and tap ADD MY TAG TO HOME SCREEN. The icon opens straight to your page, like an app.',
      'Do the same for the Scorecard (OPEN THE SCORECARD, then ADD SCORECARD TO HOME SCREEN). It\'s the fastest way to start a round.',
      'Then turn on PHONE ALERTS so you hear about challenges, @mentions, invites and rounds to confirm. On iPhone, turn alerts on from the home-screen icon.',
    ],
    tip: 'Squinting in the sun? Tap SKIN for a lighter, bigger-print look.',
  },
  {
    n: 3, kick: 'Play', title: 'Play a tag round on the Scorecard',
    body: [
      'Add everyone on your card (up to 10, guests too). Before the first score, tick the tag sets that are on the line.',
      'Best score takes the lowest number on the card. Ties keep the order they started in. Tags only swap between holders on the same card, so keep every tag holder on one card.',
      'On the last hole tap FINISH + SAVE. If something\'s missing, it tells you exactly what. Everyone else on the card confirms in MY ROUNDS on their My Tag, then the tags swap.',
    ],
    tip: 'Kept score on paper? Use + MANUAL TAG ROUND SUBMISSION on My Tag. Everyone still confirms. Both on iPhones? Touch tips to pass the card link along. Yes, really.',
  },
  {
    n: 4, kick: 'Climb', title: 'Challenge somebody (or just invite them)',
    body: [
      'MATCHUPS on My Tag: challenge anyone up to 5 spots above you. They have 48 hours to answer. 3 declines are free, the 4th drops them 5 spots.',
      'Accepted? The defender picks the tee time and course, the challenger OKs it, and up to 8 more can jump in.',
      'Not close on the board? INVITE A ROUND: anyone in your set, any spot, tags only on the line if you put them on at tee-off.',
    ],
    tip: 'Top 5 carry a 7-day time bomb when the TD has bombs on. Sit on your tag too long and it explodes to the bottom.',
  },
  {
    n: 5, kick: 'Talk', title: 'Talk trash on the Board',
    body: [
      'Every tag set has its own BOARD on My Tag. Results post there on their own, with a roast written from the real card.',
      'Type @ to call someone out, tap REPLY to answer in a thread, react with a skull, fire, trash can or flex.',
      'LEADERBOARD under your tag shows who holds what. MY ROUNDS keeps every card you\'ve played.',
    ],
    tip: 'Something broken or got an idea? Hit the skull in the corner of any page and tell the Bone Lab.',
  },
];

export default function StartPage() {
  return (
    <section className="sec st">
      <div className="sec-inner">
        <SectionHeading kicker="Bare Bones 2.0 · new here?" title="Start here" size="l" as="h1" />
        <p className="lead">Digital bag tags, a scorecard that settles them, challenges, and a Board for the trash talk. Five steps and you're in.</p>
        <ol className="st-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="st-step">
              <div className="st-n" aria-hidden="true">{s.n}</div>
              <div className="st-body">
                <div className="kick">{s.kick}</div>
                <h2>{s.title}</h2>
                {s.body.map((p) => <p key={p}>{p}</p>)}
                {s.tip && <p className="st-tip">{s.tip}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="row">
          <Button to="/tags" size="lg">See the tag boards</Button>
          <Button to="/scorecard" variant="outline" size="lg">Open the Scorecard</Button>
          {CLUB.facebookUrl && <Button href={CLUB.facebookUrl} external variant="outline" size="lg">Ask for a tag ↗</Button>}
        </div>
        <p className="st-foot">Have Fun, Help Out. And don't be a dick, be a Boner. <Link to="/rounds">Boner Rounds ›</Link></p>
      </div>
    </section>
  );
}
