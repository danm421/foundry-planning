// The dictionary Gate 7 reads: given names that are ONLY names.
//
// Hand-written, deliberately. Not fetched from a name service and not generated
// — a downloaded list is exactly the thing that puts "Will", "Grace", "Penny"
// and "August" in front of a gate that reads capitalised words, and a financial
// report is full of capitalised words: every sentence opener, every Title Case
// heading, every month, every fund.
//
// ⚠️ THE ASYMMETRY IS THE WHOLE DESIGN. Gate 7 has no sentence-position
// exemption — "Cooper, your plan holds up" is both the leak the gate exists for
// and the one shape `prompts.ts` permits a name in, so the gate cannot excuse a
// name for sitting first. The entire false-positive defence therefore lives
// HERE, and the two directions do not cost the same:
//
//   a name MISSING from this list  → one leak this gate does not catch, on a
//                                    sample `voice/scrub.ts` is there to have
//                                    taken the names out of first. A second
//                                    line missing it, not a first.
//   a name WRONGLY in this list    → a correct chapter rejected, its one retry
//                                    spent, and a fallback weaker than the prose
//                                    it replaced. Every household, every run.
//
// So this list under-fires by construction, and when an entry is arguable it is
// left out.
//
// THE TEST, APPLIED TO EVERY ENTRY IN EVERY GROUP BELOW: could an advisor write
// this word, capitalised, in a chapter about a family's money? Anything that
// could is out —
//
//   ordinary words     Will · Mark · Bill · Rich · Frank · Art · Grace · Hope ·
//                      Faith · Rose · Guy · Don · Jack · Sue · Miles · Chance
//   money words        Penny · Sterling · Cash · Bond · Buck · Grant · Max ·
//                      Cliff · Trust
//   calendar           May · June · April · August · Dawn · Summer · Autumn
//   objects & nature   Hazel · Ivy · Violet · Ruby · Amber · Olive · Lily ·
//                      Iris · Holly · Willow · Pearl · Wren · Reed · Stone
//   trades             Mason · Hunter · Baker · Miller · Fisher · Carter
//   places             Austin · Madison · Charlotte · Savannah · Virginia ·
//                      Georgia · Carolina · Phoenix · Aurora · Brooklyn
//   firms, funds,      Charles (Schwab) · Edward (Jones) · Raymond / James
//   forms, and people  (Raymond James) · Morgan · Stanley · Merrill · Dean ·
//   a report quotes    Franklin · Russell (2000) · Lincoln · Jackson · Lloyd's ·
//                      John (Hancock) · Spencer (Marks &) · Oliver (Wyman) ·
//                      Arthur (Andersen) · Monte / Carlo (Monte Carlo runs in
//                      every plan) · Warren (Buffett) · Jerome (Powell) · Milton
//                      (Friedman) · Adam (Smith) · Benjamin (Graham, and the
//                      Benjamins) · Gordon (growth model) · Kelly (criterion) ·
//                      Taylor (rule) · Edgar (the SEC's filing system) ·
//                      Troy (ounce) · Harvey (a named hurricane, which lands in
//                      the insurance chapter of all places)
//   idioms             Sam (Uncle Sam) · Peter / Paul (robbing one to pay the
//                      other) · Riley (the life of)
//
// Entries sit inside classes this list names and are IN anyway, because the
// test is about the word as a money chapter would write it, not about the
// category: `heather` (the plant is never capitalised in one) and `jordan` (the
// country, which a US household's plan has no occasion to name — unlike Virginia
// or Georgia, which state-tax prose names constantly, and which are out). `chad`
// is the same shape, for the same reason — see its own comment below rather
// than restating the argument here, which is how this list's count of them
// went stale before.
//
// ⚠️ That list is the second pass, not the first. The first version of this file
// applied the test to the common-names groups and NOT to the app-fixture group,
// and shipped `john` and `sam` — "The John Hancock policy pays out first" and
// "Uncle Sam takes his cut" both rejected a correct chapter. If you add an entry,
// say the sentence out loud.
//
// TWO entries knowingly fail the test, both of them this app's own audit
// households — the likeliest real leak, and the reason to accept the collision:
//
//   cooper  a cooper makes barrels; the noun is dead in modern American prose.
//   alan    Alan Greenspan, a Fed chair a client chapter has no reason to name
//           (unlike Powell, who is current — `jerome` is out).
//
// GIVEN names only. A surname that leaks is not in here and Gate 7 will not see
// it; `voice/scrub.ts` takes the household name out of a sample — bare,
// possessive and plural — and that is the pass surnames are covered by, once the
// harvest path calls it.

/** Names this app has actually seen — its dev fixtures and its audit
 *  households. These are the ones a real leak is most likely to be made of,
 *  because they are the households whose chapters get harvested. */
const SEEN_IN_THIS_APP = [
  "ada",
  "alan",
  "alex",
  "alice",
  "ann",
  "anna",
  "avery",
  "carol",
  "caroline",
  "casey",
  "cooper",
  "dan",
  "dana",
  "emma",
  "jane",
  "jim",
  "jonathan",
  "jordan",
  "kevin",
  "linda",
  "michael",
  "noah",
  "sarah",
  "susan",
  "teresa",
  "tom",
  "zoe",
];

/** The common US given names, women then men, with the classes above removed. */
const COMMON_US_GIVEN_NAMES = [
  // women
  "abigail",
  "addison",
  "allison",
  "amanda",
  "amelia",
  "amy",
  "andrea",
  "angela",
  "aria",
  "ashley",
  "athena",
  "aubrey",
  "audrey",
  "barbara",
  "bella",
  "beverly",
  "bonnie",
  "brenda",
  "brittany",
  "catherine",
  "charlene",
  "cheryl",
  "chloe",
  "christina",
  "christine",
  "claire",
  "clara",
  "colleen",
  "cora",
  "courtney",
  "cynthia",
  "danielle",
  "deborah",
  "debra",
  "denise",
  "diana",
  "diane",
  "donna",
  "doris",
  "dorothy",
  "eileen",
  "eleanor",
  "elena",
  "elizabeth",
  "ella",
  "ellen",
  "ellie",
  "emilia",
  "emily",
  "erin",
  "eva",
  "evelyn",
  "frances",
  "gabriella",
  "gail",
  "gloria",
  "hailey",
  "hannah",
  "heather",
  "helen",
  "irene",
  "isabella",
  "isla",
  "jacqueline",
  "janet",
  "janice",
  "jennifer",
  "jessica",
  "joan",
  "josephine",
  "joyce",
  "judith",
  "judy",
  "julia",
  "julie",
  "karen",
  "kathleen",
  "kathryn",
  "kayla",
  "kimberly",
  "kristen",
  "laura",
  "lauren",
  "layla",
  "leah",
  "leslie",
  "liliana",
  "lillian",
  "lisa",
  "lois",
  "lori",
  "lorraine",
  "louise",
  "lucy",
  "luna",
  "lydia",
  "madeline",
  "madelyn",
  "margaret",
  "maria",
  "marie",
  "marilyn",
  "marjorie",
  "martha",
  "mary",
  "megan",
  "melanie",
  "melissa",
  "michelle",
  "mila",
  "monica",
  "nancy",
  "naomi",
  "natalia",
  "natalie",
  "nicole",
  "nina",
  "nora",
  "olivia",
  "pamela",
  "patricia",
  "penelope",
  "phyllis",
  "quinn",
  "rachel",
  "rebecca",
  "renee",
  "rita",
  "ruth",
  "sadie",
  "samantha",
  "sandra",
  "sara",
  "scarlett",
  "sharon",
  "shirley",
  "sophia",
  "stella",
  "stephanie",
  "tara",
  "terri",
  "theresa",
  "tiffany",
  "tina",
  "tracy",
  "vanessa",
  "veronica",
  "victoria",
  "vivian",
  "wendy",
  "yvonne",
  // men
  "aaron",
  "albert",
  "alexander",
  "alfred",
  "allen",
  "andrew",
  "anthony",
  "arnold",
  "barry",
  "bradley",
  "brandon",
  "brian",
  "bruce",
  "bryan",
  "calvin",
  "carl",
  // Dropped in an earlier round on "hanging chad", then RESTORED: that phrase is
  // lower case, and this gate only ever sees a capital, so no collision line
  // could be written for it. The rule this restores by lives in
  // `foreign-names.test.ts` — "a drop with no covering line is an opinion, not
  // curation" — not this file's own "when an entry is arguable it is left out"
  // default near the top: that default governs new entries; this one governs
  // undoing a drop that never had a real collision behind it.
  "chad",
  "christopher",
  "clarence",
  "clifford",
  "clyde",
  "cody",
  "colin",
  "craig",
  "curtis",
  "damon",
  "daniel",
  "darren",
  "david",
  "dennis",
  "dominic",
  "donald",
  "douglas",
  "dwight",
  "dylan",
  "edwin",
  "elijah",
  "elmer",
  "eric",
  "ernest",
  "ethan",
  "eugene",
  "everett",
  "felix",
  "fernando",
  "floyd",
  "francis",
  "frederick",
  "gabriel",
  "gary",
  "george",
  "gerald",
  "gilbert",
  "glenn",
  "gregory",
  "harold",
  "harry",
  "hector",
  "henry",
  "herbert",
  "howard",
  "hugh",
  "ian",
  "isaac",
  "ivan",
  "jacob",
  "jared",
  "jason",
  "javier",
  "jeffrey",
  "jeremy",
  "jesse",
  "joel",
  "jorge",
  "jose",
  "joseph",
  "joshua",
  "juan",
  "justin",
  "keith",
  "kenneth",
  "kurt",
  "kyle",
  "larry",
  "lawrence",
  "leo",
  "leonard",
  "lewis",
  "logan",
  "louis",
  "lucas",
  "luis",
  "luke",
  "manuel",
  "marco",
  "marcus",
  "mario",
  "martin",
  "marvin",
  "matthew",
  "maurice",
  "melvin",
  "miguel",
  "mitchell",
  "nathan",
  "nathaniel",
  "neil",
  "nelson",
  "nicholas",
  "norman",
  "omar",
  "oscar",
  "owen",
  "patrick",
  "pedro",
  "perry",
  "philip",
  "phillip",
  "rafael",
  "ralph",
  "ramon",
  "randall",
  "raul",
  "ricardo",
  "richard",
  "robert",
  "roberto",
  "rodney",
  "roger",
  "roland",
  "ronald",
  "roy",
  "ruben",
  "rudy",
  "ryan",
  "salvador",
  "samuel",
  "saul",
  "scott",
  "sean",
  "sergio",
  "seth",
  "shane",
  "shawn",
  "sidney",
  "simon",
  "stephen",
  "steven",
  "stuart",
  "ted",
  "theodore",
  "thomas",
  "timothy",
  "tony",
  "travis",
  "tyler",
  "vincent",
  "wallace",
  "walter",
  "wayne",
  "wesley",
  "william",
  "xavier",
  "zachary",
];

/**
 * Names the two groups above miss for a reason worth naming: they are drawn from
 * the common US lists, which are overwhelmingly Anglo. Left there, Gate 7 would
 * protect a household called Sarah and Michael and do NOTHING AT ALL for one
 * called Priya and Raj — under-firing everywhere is the accepted cost, but
 * under-firing along one demographic line is a different thing and not one to
 * ship.
 *
 * Not exhaustive, and cannot be: it closes the systematic half of the gap, and
 * the accented spellings are listed beside the unaccented ones because a
 * household writes its own name either way. Every entry went through the same
 * test as the rest — `alma` ("alma mater"), `jun` (a month abbreviated) and `ye`
 * ("ye olde") were dropped by it.
 */
const GIVEN_NAMES_BEYOND_THE_ANGLO_SET = [
  // South Asian
  "aditya",
  "ananya",
  "arjun",
  "kavita",
  "meera",
  "priya",
  "raj",
  "ravi",
  "sanjay",
  "vikram",
  // East Asian
  "akira",
  "chen",
  "hana",
  "jing",
  "kenji",
  "mei",
  "ming",
  "sakura",
  "wei",
  "yuki",
  // Middle Eastern
  "ahmed",
  "aisha",
  "ali",
  "fatima",
  "hassan",
  "ibrahim",
  "khalid",
  "nadia",
  "tariq",
  "yasmin",
  // Hispanic, beyond the names the US lists already carry
  "alejandro",
  "carmen",
  "guadalupe",
  "josé",
  "maría",
  "mateo",
  "rosa",
  "sebastian",
  "sofía",
  "valentina",
  // African and African-American
  "aaliyah",
  "amara",
  "imani",
  "jamal",
  "kwame",
  "malik",
  "tyrone",
  "zuri",
  // Slavic
  "dmitri",
  "mikhail",
  "natasha",
  "olga",
  "svetlana",
  "tatiana",
];

/** Lowercased on the way in, so an entry typed with a capital cannot become a
 *  name the gate looks up and can never find. */
export const GIVEN_NAMES: ReadonlySet<string> = new Set(
  [...SEEN_IN_THIS_APP, ...COMMON_US_GIVEN_NAMES, ...GIVEN_NAMES_BEYOND_THE_ANGLO_SET].map((name) =>
    name.toLowerCase(),
  ),
);
