"""Keyword-based classifier for camps.

`TAGS` is the taxonomy. Each entry maps a tag → list of regex patterns.
All patterns are matched case-insensitively; use `\\b` word boundaries to
avoid false positives (so `art` doesn't match `heart` or `party`). A camp
gets a tag if any of its patterns hits the combined text of the camp name
+ description + every event's name + every event's description.

To add or tweak a tag: edit `TAGS`, then run `make test` (unit tests cover
the word-boundary invariants) and `make rebuild`.
"""
from __future__ import annotations

import re
from typing import Iterable

from .models import Art, Camp


# Keep patterns specific enough to avoid obvious false positives, but
# broad enough to tag the majority of camps that fit a category.
TAGS: dict[str, list[str]] = {
    # --- Food & drink ---
    "food": [
        r"\bfood\b", r"\bmeals?\b", r"\bfeed(?:ing)?\b", r"\bsnacks?\b",
        r"\bbreakfast\b", r"\bbrunch\b", r"\blunch\b", r"\bdinner\b",
        r"\bbbq\b", r"\bbarbecue\b", r"\bgrill(?:ed|ing)?\b", r"\bpancakes?\b",
        r"\bwaffles?\b", r"\btacos?\b", r"\bpizza\b", r"\bburgers?\b",
        r"\bhot\s*dogs?\b", r"\bsandwich(?:es)?\b", r"\bcurry\b", r"\bnoodles?\b",
        r"\bramen\b", r"\bdumplings?\b", r"\bsushi\b", r"\bsoup\b",
        r"\bice\s*cream\b", r"\bpopsicles?\b", r"\bgelato\b", r"\bchocolate\b",
        r"\bpastr(?:y|ies)\b", r"\bdonuts?\b", r"\bcookies?\b", r"\bcupcakes?\b",
        r"\bkitchen\b",
    ],
    "vegan": [r"\bvegan(?:s|ism)?\b", r"\bplant[-\s]?based\b"],
    "vegetarian": [r"\bvegetarian\b", r"\bveggie\b"],
    "bar": [
        r"\bbar\b", r"\bcocktails?\b", r"\bmixolog(?:y|ist)\b", r"\bdrinks?\s*bar\b",
        r"\bbartend(?:er|ing)\b", r"\bspeakeas(?:y|ies)\b", r"\bpub\b",
        r"\btavern\b", r"\bsaloon\b", r"\bdive\s*bar\b",
    ],
    "coffee": [r"\bcoffee\b", r"\bespresso\b", r"\blatte\b", r"\bcappuccino\b", r"\bbarista\b"],
    "tea": [r"\btea\b", r"\bchai\b", r"\bteahouse\b"],
    "cocktails": [r"\bcocktails?\b", r"\bmartinis?\b", r"\bmargaritas?\b", r"\bmojitos?\b"],
    "booze": [
        r"\bwhisk(?:e)?y\b", r"\btequila\b", r"\bmezcal\b", r"\bgin\b", r"\bvodka\b",
        r"\brum\b", r"\bbourbon\b", r"\bscotch\b", r"\bsake\b",
    ],
    "wine": [r"\bwine(?:s|ry)?\b", r"\bchampagne\b", r"\bprosecco\b", r"\brosé\b"],
    "beer": [r"\bbeers?\b", r"\bipa\b", r"\bales?\b", r"\blagers?\b", r"\bbrew(?:ery|ing)?\b"],

    # --- Intimacy / adult ---
    "sex": [
        r"\bsex\b", r"\bsexual\b", r"\bsexy\b", r"\berotic(?:a|ally)?\b",
        r"\borg(?:y|ies)\b", r"\bplay\s*party\b", r"\bpla(?:y|ier)s?\s*lounge\b",
        r"\badult(?:s|\s*only)?\b", r"\bsensual\b", r"\bhookup\b",
    ],
    "kink": [
        r"\bkink(?:y|s)?\b", r"\bbdsm\b", r"\bbondage\b", r"\brope\b",
        r"\bshibari\b", r"\bdungeon\b", r"\bflogg(?:er|ing)\b", r"\bfetish\b",
        r"\bspank(?:ing)?\b", r"\bsubmissive\b", r"\bdominatrix\b",
    ],
    "cuddles": [
        r"\bcuddl(?:e|es|ing|y|er|ers)\b", r"\bsnuggl(?:e|es|ing|y)\b",
        r"\bspoon(?:ing)?\b", r"\bpuppy\s*pile\b",
    ],
    "nudity": [r"\bnud(?:e|ity|ist)\b", r"\bnaked\b", r"\btopless\b", r"\bclothing\s*optional\b"],
    "queer": [
        r"\bqueer\b", r"\blgbtq?\+?\b", r"\bgay\b", r"\blesbian\b", r"\btrans\b",
        r"\bnon[-\s]?binary\b", r"\bpride\b", r"\bdrag\b",
    ],

    # --- Art & creative ---
    "art": [
        r"\bart(?:s|ist|istic|work|works)?\b", r"\bgaller(?:y|ies)\b",
        r"\binstallation\b", r"\bsculpture\b", r"\bmurals?\b", r"\bpaint(?:ing|ings)?\b",
        r"\bcraft(?:s|ing)?\b", r"\bcreative\b",
    ],
    "interactive_art": [
        r"\binteractive\s*art\b", r"\bparticipator(?:y|ial)\b", r"\bimmersive\b",
    ],
    "performance": [
        r"\bperformance(?:s)?\b", r"\bshow(?:s|case)?\b", r"\btheatre?\b",
        r"\bcircus\b", r"\bfire\s*(?:spinn(?:ers?|ing)|dancers?|performers?|show)\b",
        r"\bburlesque\b", r"\bcabaret\b", r"\baerial(?:ist|ists|s)?\b",
    ],
    "costume": [
        r"\bcostumes?\b", r"\bdress[-\s]?up\b", r"\bwardrobe\b", r"\bcouture\b",
        r"\bfashion\s*show\b",
    ],

    # --- Art subcategories (mostly fire on art listings) ---
    # Light-driven installations — BRC's defining medium at night.
    # Compound forms only on `light` to avoid "light moment" /
    # "lightheaded" false positives.
    "light_art": [
        r"\billuminat(?:e|es|ed|ing|ion)\b", r"\bglow(?:s|ing|ed)?\b",
        r"\bleds?\b", r"\bneon\b", r"\blanterns?\b",
        r"\bluminous\b", r"\bluminescen(?:t|ce)\b",
        r"\blight\s+(?:installation|art|sculpture|show)\b",
        r"\blight[-\s]up\b", r"\bfiber\s+optic\b",
    ],
    # Motion-driven sculpture (distinct from interactive_art which
    # implies user input).
    "kinetic": [
        r"\bkinetic\b", r"\bspin(?:s|ning|ner|ners)?\b",
        r"\brotat(?:e|es|ing|ion)\b", r"\bpendulum\b",
        r"\bwhirl(?:s|ing|er)?\b",
    ],
    # Reflection / kaleidoscope — distinct visual technique.
    "mirror_reflection": [
        r"\bmirror(?:s|ed|ing)?\b", r"\breflect(?:ive|ion|ions)\b",
        r"\bkaleidoscope\b", r"\bprism(?:s|atic)?\b",
    ],
    # Scale-as-axis: pilgrimable deep-playa landmarks.
    "monumental": [
        r"\bmonumental\b", r"\bcolossal\b", r"\btowering\b", r"\bgiant\b",
        r"\b\d{2,3}[-\s]?(?:foot|feet|ft)\s+(?:tall|high|sculpture|installation)\b",
    ],
    # Medium-of-construction. `\bmetal\b` rejected — too many
    # "metaphor" / "heavy metal music" false positives.
    "metal_sculpture": [
        r"\bsteel\b", r"\bbronze\b", r"\baluminum\b",
        r"\bwelded\b", r"\bmetallic\b",
        r"\biron\s+(?:sculpture|frame|work)\b",
    ],
    "wood_sculpture": [
        r"\bwooden\b", r"\bplywood\b", r"\btimber\b",
        r"\bdriftwood\b", r"\bcarved\s+wood\b",
    ],
    # Recurring conceptual form distinct from `mystical`.
    "portal": [
        r"\bportal(?:s)?\b", r"\bgateway\b", r"\barchway\b",
        r"\bdoorway\b", r"\bthreshold\b",
    ],
    # Navigational-scale art (lighthouse / pillar / obelisk).
    # Distinct from `monumental` — about role/function, not size.
    "beacon_landmark": [
        r"\bbeacon(?:s)?\b", r"\blandmark\b", r"\blighthouse\b",
        r"\bpillar\b", r"\bobelisk\b", r"\bmonolith\b",
    ],
    # Art-as-rest-stop. Small but useful for "where can I sit deep
    # playa" queries.
    "bench_seating": [
        r"\bbench(?:es)?\b",
        r"\bseating\s+(?:area|installation|sculpture)\b",
        r"\brest\s+stop\b",
    ],
    # Visual-style tag with strong art-only signal.
    "geometry_fractal": [
        r"\bgeometr(?:y|ic|ical)\b", r"\bfractal(?:s)?\b",
        r"\bsacred\s+geometry\b", r"\btessellat(?:e|ed|ion)\b",
        r"\bspiral(?:s)?\b",
    ],
    # Organic / botanical motif, common in 2026 (Wonderland year).
    "tree_flora": [
        r"\btrees?\b", r"\bflower(?:s)?\b", r"\bblossom(?:s|ing)?\b",
        r"\bpetals?\b", r"\bbotanical\b", r"\bgarden\b", r"\bforest\b",
    ],

    # --- Music & dance ---
    "music": [
        r"\bmusic\b", r"\blive\s*music\b", r"\bbands?\b", r"\bconcert(?:s)?\b",
        r"\bgigs?\b",
    ],
    "dj": [r"\bdj(?:s|ed|ing)?\b", r"\bturntables?\b", r"\bdecks\b"],
    "sound_camp": [r"\bsound\s*camp\b", r"\bsoundsystem\b", r"\bsound\s*system\b"],
    "dance": [
        r"\bdanc(?:e|es|ing|er|ers|efloor)\b", r"\brave(?:s)?\b", r"\bdisco\b",
        r"\bsilent\s*disco\b",
    ],
    "karaoke": [r"\bkaraoke\b", r"\bsing[-\s]?along\b"],
    "electronic": [
        r"\belectronic\b", r"\btechno\b", r"\bhouse\s*music\b", r"\bhouse\b",
        r"\btrance\b", r"\bdubstep\b", r"\bdrum\s*(?:and|&|n)\s*bass\b",
        r"\bdnb\b", r"\bbass\s*music\b",
    ],
    "live_music": [r"\blive\s*music\b", r"\bacoustic\s*set\b", r"\bjam\s*session\b", r"\bopen\s*mic\b"],

    # --- Wellness ---
    "yoga": [r"\byoga\b", r"\basanas?\b", r"\bvinyasa\b"],
    "meditation": [r"\bmeditat(?:e|es|ed|ing|ion|ions)\b", r"\bmindful(?:ness)?\b"],
    "massage": [r"\bmassage(?:s)?\b", r"\bbodywork\b"],
    "spa": [r"\bspa\b", r"\bsauna\b", r"\bhot\s*tub\b", r"\bjacuzzi\b", r"\bsteam\s*room\b"],
    "healing": [r"\bheal(?:ing|er|ers)\b", r"\bshamanic\b", r"\breiki\b", r"\benerg(?:y|etic)\s*work\b"],
    "breathwork": [r"\bbreath\s*work\b", r"\bbreathwork\b", r"\bpranayama\b"],
    "sound_bath": [r"\bsound\s*bath\b", r"\bsound\s*healing\b", r"\bgong\s*bath\b"],
    "tantra": [r"\btantra\b", r"\btantric\b"],
    "ecstatic_dance": [r"\becstatic\s*dance\b"],

    # --- Social / party ---
    "lounge": [r"\blounge\b", r"\bchill\s*(?:zone|spot|space|lounge)\b", r"\bcozy\b"],
    "party": [r"\bpart(?:y|ies|ying)\b", r"\bbash\b", r"\bshindig\b"],
    "hangout": [r"\bhangout\b", r"\bhang[-\s]?out\b", r"\bhang\s*out\b"],

    # --- Workshops / learning ---
    "workshops": [
        r"\bworkshops?\b", r"\bclasses?\b", r"\blessons?\b", r"\bteach(?:ing|ers?)?\b",
        r"\blearn(?:ing)?\b", r"\beducational\b", r"\bskill[-\s]?share\b",
    ],
    "talks": [r"\btalks?\b", r"\blectures?\b", r"\bspeakers?\b", r"\bpanels?\b"],

    # --- Games & play ---
    "games": [r"\bgames?\b", r"\btournament\b", r"\bcompetition\b", r"\bcontests?\b",
              r"\btrivia\b", r"\bbingo\b", r"\bchess\b", r"\bpoker\b", r"\bmini[-\s]?golf\b"],
    "playful": [r"\bplayground\b", r"\bplayful\b"],

    # --- Services & gifting ---
    "gifting": [r"\bgift(?:s|ing|ed)?\b", r"\bgiveaway\b"],
    "bike_repair": [r"\bbike\s*repair\b", r"\bbicycle\s*repair\b", r"\bbike\s*fix\b"],
    "haircuts": [r"\bhair\s*cuts?\b", r"\bhaircuts?\b", r"\bsalon\b", r"\bbarber\b"],
    "makeup": [r"\bmakeup\b", r"\bmake[-\s]?overs?\b", r"\bglitter\s*bar\b", r"\bface\s*paint(?:ing)?\b"],
    "costuming_service": [r"\bcostume\s*(?:shop|closet|boutique)\b"],

    # --- Identity / community ---
    "family": [r"\bfamil(?:y|ies)\b", r"\bkid[-\s]?friendly\b", r"\ball[-\s]?ages\b"],
    "kids": [r"\bkids?\b", r"\bchildren\b"],
    "women": [r"\bwomen\b", r"\bfemme\b", r"\bfeminist\b"],
    "sober": [r"\bsober\b", r"\balcohol[-\s]?free\b", r"\bdrug[-\s]?free\b", r"\brecovery\b"],

    # --- Sports / activity ---
    "sports": [r"\bsports?\b", r"\byoga\b", r"\brunning\s*club\b", r"\bgym\b", r"\bfitness\b"],
    "water": [r"\bwater\s*bar\b", r"\bhydration\b", r"\bmist(?:ing)?\s*(?:tent|station|bar)\b"],
    "shade": [r"\bshade\s*(?:structure|space|tent)\b"],

    # --- Theme camps (loose buckets) ---
    "tiki": [r"\btiki\b", r"\bluau\b"],
    "pirate": [r"\bpirate(?:s)?\b"],
    "space": [
        r"\bspace\s*(?:camp|station|themed?)\b", r"\bgalactic\b", r"\balien(?:s)?\b",
        # Broadened 2026: art and themed camps lean cosmic without
        # using the literal word "space". Adding compound + standalone
        # cosmic terms picks up another ~95 camps and ~20 art records.
        r"\bcosmic\b", r"\bcelestial\b", r"\bcosmos\b",
        r"\bnebula\b", r"\bgalax(?:y|ies)\b",
        r"\bstarlight\b", r"\bstarry\b", r"\blunar\b",
        r"\bplanetar(?:y|ium)\b", r"\bconstellation(?:s)?\b",
    ],
    "circus_carnival": [r"\bcircus\b", r"\bcarnival\b", r"\bmidway\b"],
    "cult_religious": [
        r"\bcult\b", r"\btemple\b", r"\bchurch\b", r"\bmonaster(?:y|ies)\b",
        r"\bmonks?\b", r"\bpagans?\b",
    ],
    "french": [r"\bfrench\b", r"\bparisian\b", r"\bparis\b"],
    "tropical": [r"\btropical\b", r"\bhawaiian\b", r"\bcaribbean\b", r"\bjungle\b"],
    "desert_western": [r"\bwestern\b", r"\bsaloon\b", r"\bcowboy(?:s)?\b"],
    "retro_vintage": [r"\bvintage\b", r"\bretro\b", r"\b1950s\b", r"\b1960s\b", r"\b1970s\b", r"\b1980s\b"],
    "medieval_fantasy": [r"\bmedieval\b", r"\bknights?\b", r"\bdragons?\b", r"\bwizards?\b", r"\bfantasy\b"],
    "steampunk": [r"\bsteampunk\b"],
    "cyberpunk": [r"\bcyberpunk\b"],
    "burlesque": [r"\bburlesque\b"],

    # --- Specific playful categories from the examples ---
    "pancakes": [r"\bpancakes?\b"],
    "grilled_cheese": [r"\bgrilled\s*cheese\b"],
    "bacon": [r"\bbacon\b"],
    "pickles": [r"\bpickles?\b"],
    "popsicles": [r"\bpopsicles?\b"],
    "bloody_mary": [r"\bbloody\s*mar(?:y|ys|ies)\b"],
    "mimosa": [r"\bmimosas?\b"],

    # --- Community / spiritual / vibe ---
    "community": [
        r"\bcommunit(?:y|ies)\b", r"\bbelonging\b", r"\bconnection\b",
        r"\btribe\b", r"\bkinship\b", r"\bgathering\b",
    ],
    "spiritual": [
        r"\bspiritual(?:ity)?\b", r"\btransformation(?:al)?\b", r"\bconsciousness\b",
        r"\bawaken(?:ing|ed)\b", r"\benlighten(?:ed|ment)\b", r"\bsacred\b",
        r"\bdivine\b", r"\bwisdom\b", r"\bsoul(?:ful)?\b",
    ],
    "mystical": [
        r"\boracle\b", r"\btarot\b", r"\bdivination\b", r"\bastrolog(?:y|er)\b",
        r"\brunes?\b", r"\bcrystals?\b", r"\bpsychic\b", r"\bmystic(?:al)?\b",
        r"\bwitch(?:es|craft)?\b", r"\bspells?\b",
    ],
    "psychedelic": [
        r"\bpsychedelic(?:s|a)?\b", r"\btrip(?:py|ping)\b",
    ],
    "authentic_relating": [
        r"\bauthentic\s*relating\b", r"\brelating\s*games\b", r"\bcircling\b",
    ],
    # Temple-adjacent emotional theme. Distinct from `spiritual` and
    # `cult_religious` (which are about beliefs / institutions).
    "memorial": [
        r"\bmemorial\b", r"\bremembrance\b", r"\bin\s+memory\s+of\b",
        r"\btribute\b", r"\bashes\b",
        r"\bgriev(?:e|ing|ed|ance)\b", r"\bloss\b", r"\bmourning\b",
    ],
    # BRC's most-used self-mythology word. The existing `spiritual`
    # tag already includes `transformation(?:al)?` — broader words
    # that don't require a spiritual frame go here so things like
    # "metamorphosis" / "rebirth" don't force a mystical reading.
    "transformation": [
        r"\btransform(?:s|ation|ative|ed|ing)?\b",
        r"\bevolv(?:e|es|ed|ing|ution)\b",
        r"\bmetamorpho?s(?:is|es)\b",
        r"\brebirth\b", r"\bbecoming\b",
    ],
    # 2026 official theme. Year-themed; can be retired or renamed
    # in a future cycle. Big hits on 2026 data (~100 camps + 13 art
    # + 88 events).
    "wonderland_2026": [
        r"\balice\b", r"\bwonderland\b", r"\bcheshire\b",
        r"\bmad\s+hatter\b", r"\brabbit\s+hole\b", r"\btea\s+party\b",
        r"\bdown\s+the\s+rabbit\s+hole\b",
    ],
    # Eco / leave-no-trace stance — distinct from values tags like
    # `radical_inclusion`. Specifically environmental practice.
    "sustainability": [
        r"\bsustainab(?:le|ility)\b", r"\bleave\s+no\s+trace\b",
        r"\bmoop\b", r"\beco[-\s](?:friendly|conscious)\b",
        r"\bsolar[-\s]powered\b", r"\bcompost(?:ing)?\b",
        r"\bupcycl(?:e|ed|ing)\b",
    ],
    # BM-curated showpieces. Backed by the API's `program` field
    # ("Honorarium" — 75 pieces in 2025) which flows into the art
    # haystack. Also catches description prose mentioning the
    # honorarium award. Distinct from `art` (every art is art) and
    # `monumental` (size, not curation).
    "honorarium": [
        r"\bhonorari(?:a|um)\b",
    ],
    # Man Pavilion grant program — small ring of art directly around
    # the Man (15-25 ft from center). Backed by API `program=
    # ManPavGrant` (11 pieces) AND the address-parser's "Man Pavilion"
    # synthetic-street emission for "<clock> 25', Man Pavilion".
    "man_pavilion": [
        r"\bman\s*pavilion\b", r"\bmanpavgrant\b", r"\bmanpav\b",
    ],

    # --- Personal care / pampering ---
    "pampering": [
        r"\bnails?\s*(?:painted|painting|bar|salon|polish)\b", r"\bmanicures?\b",
        r"\bpedicures?\b", r"\bpamper(?:ing)?\b", r"\brejuvenat(?:e|ing|ion)\b",
        r"\bhair\s*braid(?:ing|s)?\b", r"\bbraids?\b", r"\bbeauty\s*bar\b",
    ],
    "foot_wash": [r"\bfoot\s*wash(?:ing)?\b", r"\bfoot\s*bath\b", r"\bfoot\s*spa\b"],

    # --- Sleep / rest ---
    "nap": [r"\bnap(?:s|ping)?\b", r"\bsiesta\b", r"\bnap\s*(?:zone|area|tent)\b"],

    # --- Camp role ---
    "mutant_vehicle": [r"\bmutant\s*vehicles?\b", r"\bart\s*cars?\b"],
    "support_camp": [r"\bsupport\s*camp\b", r"\binfrastructure\s*camp\b"],

    # --- Writing / media ---
    "writing": [r"\bpoetr(?:y|ies)\b", r"\bpoems?\b", r"\bwrit(?:ing|ers?)\b",
                r"\bstor(?:y|ies)\s*tell(?:ing|ers?)\b", r"\bjournal(?:ing|s)?\b"],
    "radio": [r"\bradio\s*(?:station|show)\b", r"\bpodcast\b", r"\bbroadcast(?:ing)?\b"],
    "film": [r"\bfilm(?:s|ing)?\b", r"\bmovies?\b", r"\bcinema\b", r"\bscreening\b"],
    "photography": [r"\bphotograph(?:y|er|ers)\b", r"\bphoto\s*booth\b"],

    # --- Sexuality specifics (finer-grained) ---
    "play_party": [r"\bplay\s*part(?:y|ies)\b"],
    "tantra_workshops": [r"\btantra\s*workshops?\b"],
    "consent": [r"\bconsent(?:\s*culture|\s*workshops?)?\b"],

    # --- Games (extra) ---
    "arcade": [r"\barcade\b", r"\bpinball\b", r"\bvideo\s*games?\b"],

    # --- International / regional themes ---
    "brazilian": [r"\bbrazilian\b", r"\bsamba\b", r"\bcarnaval\b"],
    "mexican": [r"\bmexican\b", r"\blatin(?:o|x|a)?\b", r"\bmariachi\b"],
    "japanese": [r"\bjapanese\b", r"\bonsen\b", r"\bramen\b", r"\borigami\b"],
    "indian": [r"\bindian\b", r"\bbollywood\b", r"\bhenna\b", r"\bmehndi\b"],
    "middle_eastern": [r"\bmiddle\s*eastern\b", r"\bpersian\b", r"\barabic\b", r"\bhookah\b", r"\bshisha\b"],
    "russian_slavic": [r"\brussian\b", r"\bslavic\b", r"\bukrainian\b"],

    # --- Shade / services existed; add misc utilities ---
    "showers": [r"\bshowers?\b"],
    "ice": [r"\bice\s*(?:bar|cold|station)\b", r"\bice\s*cubes?\b"],

    # --- Extra food/drink ---
    "pizza": [r"\bpizza\b"],
    "grilled": [r"\bgrill(?:ed|ing|er)?\b"],
    "smoothies": [r"\bsmoothies?\b"],
    "juice": [r"\bjuice\s*bar\b", r"\bfresh\s*juice\b"],
    "shots": [r"\bshots?\b"],
    "pop_up": [r"\bpop[-\s]?up\b"],

    # --- More generic ---
    "hugs": [r"\bhugs?\b", r"\bhugging\b", r"\bembrace\b"],
    "fire": [r"\bbonfires?\b", r"\bfirepit\b", r"\bfire\s*pit\b", r"\bflame[-\s]?throwers?\b"],
    "news_media": [r"\bnewspaper\b", r"\bnews\s*(?:paper|letter)\b", r"\beditions?\b"],
    "radical_inclusion": [r"\bradical\s*inclusion\b", r"\bradical\s*self[-\s]?expression\b"],
    "meat": [r"\bmeats?\b", r"\bcharcuterie\b", r"\bsausage(?:s)?\b"],
    "bread": [r"\btoast\b", r"\bbread\b", r"\bbiscuits?\b", r"\bbagels?\b", r"\bcroissants?\b"],
    "bubbles": [r"\bbubbles?\b", r"\bbubble\s*bath\b"],
    "welcome": [r"\bwelcom(?:e|ing)\b"],

    # --- Fringe specifics ---
    "sauna": [r"\bsaunas?\b"],
    "hot_tub": [r"\bhot\s*tubs?\b"],
    "silent_disco": [r"\bsilent\s*disco\b"],
    "orgy_dome": [r"\borgy\s*dome\b"],
    "gender_play": [r"\bgender\s*bend(?:er|ing)\b", r"\bdrag\s*queens?\b", r"\bdrag\s*kings?\b"],
}


class Tagger:
    """Compiled-taxonomy matcher. Construct once, reuse for many camps."""

    def __init__(self, taxonomy: dict[str, list[str]] = TAGS):
        self.compiled: dict[str, list[re.Pattern[str]]] = {
            name: [re.compile(p, re.IGNORECASE) for p in pats]
            for name, pats in taxonomy.items()
        }

    def tag(self, text: str) -> list[str]:
        """Return every tag whose any-pattern hits `text`."""
        found: list[str] = []
        for name, patterns in self.compiled.items():
            if any(p.search(text) for p in patterns):
                found.append(name)
        return found

    @staticmethod
    def haystack(camp: Camp) -> str:
        """The text a camp is tagged against: name + description + events."""
        parts: list[str] = [camp.name, camp.description]
        for e in camp.events:
            parts.append(e.name)
            parts.append(e.description)
        return " ".join(p for p in parts if p)

    def tag_camp(self, camp: Camp) -> list[str]:
        return self.tag(self.haystack(camp))

    def tag_all(self, camps: Iterable[Camp]) -> None:
        """In-place: populate `camp.tags` for every camp."""
        for camp in camps:
            camp.tags = self.tag_camp(camp)

    @staticmethod
    def art_haystack(art: Art) -> str:
        """Text an art piece is tagged against. Same taxonomy as camps —
        we don't maintain a separate art taxonomy because nearly every
        meaningful tag (interactive, sound-camp, fire, sculpture, etc.)
        applies cleanly to either. Includes artist + category + program
        because those carry signal for art-specific terms (e.g.,
        category="Mutant Vehicles" surfaces the `mutant_vehicle` tag)."""
        parts: list[str] = [
            art.name, art.description, art.artist,
            art.category, art.program,
        ]
        return " ".join(p for p in parts if p)

    def tag_art(self, art: Art) -> list[str]:
        return self.tag(self.art_haystack(art))

    def tag_all_art(self, art: Iterable[Art]) -> None:
        """In-place: populate `piece.tags` for every art piece."""
        for piece in art:
            piece.tags = self.tag_art(piece)
