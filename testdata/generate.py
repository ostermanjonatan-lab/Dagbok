"""Skapar två års påhittade dagboksinlägg för att testa appen."""
import base64, io, json, random, sys
from datetime import date, timedelta
from PIL import Image, ImageDraw

random.seed(20261023)
START, END = date(2024, 10, 23), date(2026, 10, 22)

TEMP = {1: -1, 2: -1, 3: 2, 4: 7, 5: 12, 6: 17, 7: 19, 8: 18, 9: 13, 10: 8, 11: 3, 12: 0}

def weather(d):
    t = TEMP[d.month] + random.gauss(0, 3.5)
    cold = t < 1
    r = random.random()
    if d.month in (6, 7, 8):
        codes = [(0, .30), (1, .10), (2, .25), (3, .12), (61, .08), (80, .08), (95, .05), (63, .02)]
    elif d.month in (12, 1, 2):
        codes = [(0, .10), (2, .12), (3, .35), (45, .06), (71, .14), (73, .12), (61, .06), (51, .05)]
    else:
        codes = [(0, .14), (1, .08), (2, .22), (3, .26), (45, .05), (61, .12), (63, .07), (80, .06)]
    acc = 0
    for code, p in codes:
        acc += p
        if r <= acc:
            break
    if cold and code in (61, 63, 80, 51):
        code = 71
    if not cold and code in (71, 73):
        code = 61
    return {"code": code, "temp": round(t, 1), "time": "12:00"}

WEEKDAY = [
    "Lång dag på jobbet. Mötet om budgeten drog över med en timme.",
    "Jobbade hemifrån och fick mycket gjort på förmiddagen.",
    "Lunch med Sara, vi pratade om resan i sommar.",
    "Tränade på gymmet efter jobbet, ben och rygg.",
    "Sprang fem kilometer runt sjön innan frukost.",
    "Hämtade på förskolan och lagade tacos till middag.",
    "Trött i dag. Somnade tidigt framför en serie.",
    "Ny kollega började, verkar trevlig.",
    "Presentationen gick bättre än jag trodde.",
    "Satt fast i kö på vägen hem i nästan en timme.",
    "Ringde mamma och pratade länge om ingenting särskilt.",
    "Bakade bröd för första gången på länge.",
    "Läste ut boken jag hållit på med i flera veckor.",
    "Handlade inför helgen och städade köket.",
    "Huvudvärk hela eftermiddagen, gick och lade mig tidigt.",
    "Fikade med Erik på stan efter jobbet.",
    "Lugn kväll med te och korsord.",
    "Planerade nästa veckas middagar, känns skönt att vara i fas.",
]
WEEKEND = [
    "Sov länge och åt en lång frukost.",
    "Promenad i skogen hela förmiddagen.",
    "Middag hos Johanna och Ali, blev sent.",
    "Storstädade lägenheten och bytte lakan.",
    "Var på loppis och hittade en fin lampa.",
    "Cyklade ut till ön och badade.",
    "Såg en film på bio med Sara.",
    "Hjälpte pappa att flytta möbler.",
    "Brunch med gänget, skrattade mycket.",
    "Regnig dag inne med pussel och musik.",
    "Lagade lasagne från grunden.",
    "Åkte till landet och eldade ris.",
]
SEASON = {
    12: ["Pyntade granen.", "Glöggmys med grannarna.", "Slog in julklappar hela kvällen."],
    1: ["Mörkt och kallt, längtar efter ljuset.", "Åkte skridskor på sjön.", "Snöskottade uppfarten."],
    2: ["Skidade i spåret efter jobbet.", "Sportlovsplanering."],
    3: ["Första vårdagen, satt ute i solen en stund.", "Snödropparna har kommit upp."],
    4: ["Påskmiddag med familjen.", "Krattade trädgården."],
    5: ["Allt blommar nu.", "Första glassen för året."],
    6: ["Ljusa kvällar, svårt att somna.", "Badade för första gången i år, kallt."],
    7: ["Semester! Läste i hängmattan.", "Grillade och satt ute till midnatt."],
    8: ["Kräftskiva hos grannarna.", "Plockade blåbär i skogen."],
    9: ["Plockade svamp, mest kantareller.", "Hösten känns i luften."],
    10: ["Löven har börjat falla.", "Tände ljus på morgonen igen."],
    11: ["Grått och blött hela dagen.", "Första frosten på bilrutan."],
}
SPECIAL = {
    (12, 24): ("Julafton", ["Julbord hos mormor", "Kalle Anka klockan tre", "Fick en ny tröja"], 5),
    (12, 31): ("Nyårsafton", ["Tolvslaget på balkongen", "Raketer över stan", "Nyårslöfte: mer promenader"], 4),
    (6, 20): ("Midsommarafton", ["Sill och nypotatis", "Dansade runt stången", "Plockade sju sorters blommor"], 5),
    (6, 19): ("Midsommarafton", ["Sill och nypotatis", "Dansade runt stången", "Regn på eftermiddagen"], 4),
    (3, 14): ("Födelsedag", ["Tårta på jobbet", "Middag på restaurang", "Fick blommor av Sara"], 5),
    (8, 2): ("Första semesterdagen", ["Packade bilen", "Körde norrut", "Tältade vid sjön"], 5),
}
MIDSUMMER = {2025: date(2025, 6, 20), 2026: date(2026, 6, 19)}

def photo(seed, kind):
    rnd = random.Random(seed)
    w, h = 640, 480
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    sky = {"sommar": ((126, 182, 230), (220, 236, 248)), "vinter": ((168, 186, 204), (232, 238, 244)),
           "kväll": ((70, 40, 90), (240, 150, 110)), "höst": ((150, 170, 190), (230, 214, 190))}[kind]
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(*sky)))
    sx, sy = rnd.randint(80, 560), rnd.randint(60, 160)
    d.ellipse([sx - 34, sy - 34, sx + 34, sy + 34], fill=(255, 236, 170) if kind != "vinter" else (245, 245, 235))
    ground = {"sommar": (88, 140, 80), "vinter": (240, 244, 248), "kväll": (40, 30, 50), "höst": (170, 110, 60)}[kind]
    pts = [(0, h)] + [(x, int(h * 0.62 + 40 * __import__("math").sin(x / 90 + rnd.random() * 6))) for x in range(0, w + 40, 40)] + [(w, h)]
    d.polygon(pts, fill=ground)
    for _ in range(rnd.randint(3, 7)):
        tx = rnd.randint(0, w); ty = int(h * 0.6) + rnd.randint(-10, 30)
        d.polygon([(tx, ty - rnd.randint(50, 90)), (tx - 18, ty), (tx + 18, ty)],
                  fill=(40, 80, 50) if kind != "vinter" else (60, 90, 70))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

entries, images = {}, {}
pid = 0

def add_photos(d, n, kind):
    global pid
    ids = []
    for _ in range(n):
        pid += 1
        i = "test%028d" % pid
        images[i] = photo(pid, kind)
        ids.append(i)
    return ids

d = START
while d <= END:
    special = SPECIAL.get((d.month, d.day))
    if (d.month, d.day) in ((6, 19), (6, 20)) and MIDSUMMER.get(d.year) != d:
        special = None
    # Hoppar över ungefär var femte vanlig dag, som i en riktig dagbok
    if not special and random.random() < 0.2 and d not in (date(2024, 10, 23), date(2025, 10, 23)):
        d += timedelta(days=1)
        continue
    w = weather(d)
    photos = []
    if special:
        title, items, mood = special
        text = f"# {title}\n" + "\n".join("- " + i for i in items) + "\n" + random.choice(["En fin dag.", "Somnade **helt slut** men glad.", "Det här vill jag minnas."])
        kind = "vinter" if d.month in (12, 1, 2, 3) else "sommar"
        photos = add_photos(d, random.randint(1, 3), kind)
    else:
        pool = WEEKEND if d.weekday() >= 5 else WEEKDAY
        parts = random.sample(pool, random.choice([1, 1, 2, 2, 3]))
        if random.random() < 0.35:
            parts.append(random.choice(SEASON[d.month]))
        if random.random() < 0.12:
            i = random.randrange(len(parts))
            words = parts[i].rstrip(".").split(" ")
            k = random.randrange(len(words))
            words[k] = f"**{words[k]}**"
            parts[i] = " ".join(words) + "."
        if random.random() < 0.1:
            text = random.choice(["## Att göra\n", "## Bra saker i dag\n"]) + "\n".join("- " + p.rstrip(".") for p in parts)
        else:
            text = " ".join(parts)
        base = 4 if d.weekday() >= 5 else 3
        if w["code"] in (0, 1) and d.month in (4, 5, 6, 7, 8): base += 0.5
        if w["code"] in (61, 63, 3, 45) and d.month in (11, 12, 1): base -= 0.5
        mood = max(1, min(5, round(random.gauss(base, 0.9))))
        if random.random() < 0.06:
            photos = add_photos(d, 1, {12: "vinter", 1: "vinter", 2: "vinter", 9: "höst", 10: "höst", 11: "höst"}.get(d.month, "sommar"))
    if not special and random.random() < 0.05:
        mood = None
    entry = {"text": text, "mood": mood, "weather": w, "photos": photos, "updated": f"{d.isoformat()}T21:{random.randint(0, 59):02d}:00.000Z"}
    entries[d.isoformat()] = entry
    d += timedelta(days=1)

out = {"app": "dagbok", "version": 3, "entries": entries, "images": images}
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
print(len(entries), "dagar,", len(images), "bilder")
