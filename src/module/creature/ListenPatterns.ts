import { TalkVolume } from "@/enums/engine/TalkVolume";

/**
 * Shouts: how far a spoken string travels and which listener pattern it fires.
 *
 * The retail AI (k_ai_master, k_inc_generic) brings allies into a fight with
 * silent shouts: `SpeakString("GEN_I_WAS_ATTACKED", TALKVOLUME_SILENT_TALK)`,
 * heard by every listening creature in range whose `SetListenPattern` matches,
 * which then runs its OnDialog (OnConversation) script with that pattern
 * number.
 */

/** Who hears a string spoken at a given volume. */
export interface TalkVolumeReach {
  /** Metres from the speaker. */
  range: number;
  /** Area creatures (everyone not in the party). */
  creatures: boolean;
  /** Party members, who are not in the area's creature list. */
  party: boolean;
}

/**
 * TALK, WHISPER and SHOUT reach no listener here (their audible side is not
 * modelled). The silent volumes reach creatures that listen: SILENT_TALK within
 * talk range, SILENT_SHOUT across the area. Party members are creatures like
 * any other in retail, so both silent volumes reach them; this engine keeps
 * them outside `area.creatures`, so they are named separately.
 */
export function talkVolumeReach(volume: TalkVolume): TalkVolumeReach {
  switch(volume){
    case TalkVolume.SILENT_TALK:
      return { range: 20, creatures: true, party: true };
    case TalkVolume.SILENT_SHOUT:
      return { range: 1000, creatures: true, party: true };
    default:
      return { range: 5, creatures: false, party: false };
  }
}

/**
 * The pattern number a heard string fires, or undefined when none matches.
 * Scripts register patterns as authored (`GEN_I_WAS_ATTACKED`) while spoken
 * strings arrive lowercased, so the match ignores case.
 */
export function matchListenPattern(patterns: Record<string, number> | undefined, heard: string): number | undefined {
  if(!patterns || typeof heard !== 'string') return undefined;
  const exact = patterns[heard];
  if(typeof exact === 'number') return exact;
  const wanted = heard.toLowerCase();
  for(const key of Object.keys(patterns)){
    if(key.toLowerCase() === wanted) return patterns[key];
  }
  return undefined;
}

export interface HeardStringLike<TSpeaker> {
  speaker: TSpeaker;
  string: string;
}

export interface ListenerLike<TSpeaker> {
  isListening: boolean;
  listeningPatterns: Record<string, number>;
  heardStrings: HeardStringLike<TSpeaker>[];
}

/**
 * Takes the next heard string off the listener's queue and returns it with the
 * pattern it matched, or undefined when nothing fires this time.
 *
 * Every string is consumed whether it matches or not: an unmatched string left
 * at the head used to block every shout queued behind it for good (creatures
 * were seen holding 15 to 226 unprocessed shouts). A creature that is not
 * listening hears nothing, so its queue is discarded.
 */
export function takeHeardShout<TSpeaker>(listener: ListenerLike<TSpeaker>): { speaker: TSpeaker; pattern: number } | undefined {
  const queue = listener.heardStrings;
  if(!queue || !queue.length) return undefined;
  if(!listener.isListening){
    queue.length = 0;
    return undefined;
  }
  const heard = queue.shift();
  if(!heard) return undefined;
  const pattern = matchListenPattern(listener.listeningPatterns, heard.string);
  if(typeof pattern === 'undefined') return undefined;
  return { speaker: heard.speaker, pattern };
}
