# Stan aktualny: Fronty i prowincje 2.0 (14.11.2026)

Aktualny opis zmian i ograniczeń: RAPORT_ZMIAN.txt. Uruchomienie: GRA.html.
Poniżej pozostawiono archiwalny dziennik wcześniejszej wersji; opisane w nim
oblężenia i automatyczny powrót okupowanych prowincji zostały zastąpione.

---

# Europa 1400 — gra strategiczna (prototyp)

Original prompt: chce zrobić gre z mapa jak europa universalis 5 w roku 1400 gdzie podczas wojen przejmowanie terenóœ jest bardzo realistyczne

## Plan
- Mapa Europy 1400 na bazie realnych danych granic (aourednik/historical-basemaps, world_1400.geojson)
- Prowincje generowane z krajów (Voronoi + łączenie komponentów), ~1300 komórek/prowincję
- Mechanika wojen: oblężenia z progresem, okupacja ≠ własność, transfer tylko w traktacie pokojowym,
  żądania tylko dla prowincji okupowanych/sąsiadujących z kontrolą, wyczerpanie wojną, bitwy, odporność fortów
- UI po polsku, styl pergaminowy

## Stan (testy, 10.11)
- Pełny cykl wojny przetestowany end-to-end: wypowiedzenie (sojusznicy wchodzą probabilistycznie), marsz, bitwy,
  oblężenia z progresem, okupacja (pasy na mapie), odzysk prowincji przez garnizon po ~25 dniach bez okupanta,
  punkty wojenne, wyczerpanie, traktat pokojowy (żądania tylko okupowane/przy froncie, koszt ≤ punkty×(1+wyczerpanie×0.045)),
  cesja własności + 5-letni rozejm — wszystko działa.
- Naprawione błędy: tick kumulował ułamki dnia (wolne prędkości nie upływały), ekran startowy na mobile (scroll flex),
  etykiety (kolizje, halo kontrastowe, generyczne nazwy tylko przy zoom ≥ 4.6), gramatyka paska wojny (narzędnik).
- FPS ~59, brak błędów konsoli, mobile 375px OK.
- Znane ograniczenia prototypu: brak floty, wasali, rebelii; granice/prowincje przybliżone (zbiór 1400).

## Poprawka znaczników armii (prośba użytkownika)
- Armie i paski oblężeń rysowane w przestrzeni ekranu po zdjęciu transformacji mapy (wcześniej „odjeżdżały” przy zoomie); środek mapy liczony w px CSS (fix dla ekranów HiDPI).
- Armia „stoi” na punkcie prowincji: cień na ziemi + tarcza nad nim; kilka armii w jednej prowincji rozsuwanych obok siebie.
- Punkt prowincji = najgłębszy punkt wnętrza (transformata odległości), nazwa prowincji pod nim.
- Kliknięcie: armia, potem dowolna prowincja = rozkaz marszu (wcześniej odznaczało).
- Generator: globalne dopasowanie nazw regionów do najbliższych prowincji (≤2.2°).
- Test: przy zoomie 1.4–7 i DPR 1/2 punkt każdej widocznej armii leży w jej prowincji (0 błędów).

## Naprawa: przejmowanie prowincji nie działało (zgłoszenie użytkownika)
- Przyczyna: Polska i Zakon były na starcie sojusznikami, a wypowiedzenie wojny nie zrywało sojuszu → hostile()=false → brak oblężeń.
- Fix: wojna zrywa sojusz stron; hostile = atWar; sameSide tylko bez wojny; sojusznik obu stron zostaje neutralny; historyczne sojusze Polski: Węgry, Mołdawia.
- Wiszące paski oblężeń po odejściu armii — czyszczone.
- SI nie porzuca trwającego oblężenia; rozdziela armie na najbliższe cele.
- Garnizon nie odnawia się w trakcie oblężenia; log z prawdziwą liczbą dni, komunikat „Rozpoczęto oblężenie”, bez spamu.
- Traktat: osobny komunikat odrzucenia, licznik „wybrane / limit” na czerwono gdy za dużo; panel: % oblężenia i szacunek dni.
- Test UI: wojna → marsz → kapitulacja Ziemi Chełmińskiej (120 dni) i Prus Dolnych (142 dni) → traktat → cesja.
- Fix: pasek wojny i panel boczny nie są już przebudowywane co klatkę (przyciski Negocjuj pokój / Rekrutuj nie reagowały na kliknięcia).
- Fix: traktat z reparacjami rzucał wyjątek w makePeace (terms.gold jako pojedynczy obiekt) — przycisk wysłania posłów nic nie robił.
- Dyplomacja w stylu Age of History 2 (js/diplo.mjs): stosunki −100..100 z dryfem i napięciami granicznymi, punkty dyplomacji (+1,5/mies., maks. 10), poprawa stosunków / dary / obelgi, sojusze, pakty o nieagresji (10 lat, blokują wojnę), prawo przejścia (5 lat, armie przechodzą przez ziemie), gwarancje niepodległości, wasale (trybut 15%, walczą razem, aneksja po 5 latach), wezwania do wojny (odmowa zrywa sojusz), pokój separatystyczny, propozycje AI (karty po lewej, wezwania/pokój pauzują grę), AI wypowiada wojny i zawiera pokoje między sobą, mapa dyplomatyczna (M) z legendą, okno dyplomacji (D) pauzuje grę.

## Dzielenie armii (przepoławianie)
- Zaznacz armię → klawisz **S** lub przycisk „½” przy armii w panelu prowincji: dzieli na dwie równe części (nieparzyste: różnica 1 człowiek). Nowa połowa stoi w tej samej prowincji, ma to samo morale i jest od razu zaznaczona (gotowa na rozkaz marszu); oryginał zachowuje swój rozkaz marszu.
- Ograniczenia: tylko własna armia, po zakończonej mobilizacji, min. 400 ludzi (każda połowa ≥ 200, bo armie <120 giną po bitwie).
- Armie **gracza nie sklejają się już automatycznie** (wcześniej `mergeArmies` scalał je codziennie, co cofałoby podział). Łączenie ręczne: klawisz **C** lub „Połącz stojące armie” — łączy tylko stojące i gotowe armie w prowincji, morale = średnia ważona rozmiarem. AI nadal skleja armie samo.
- Oblężenie liczy teraz sumę armii jednego kraju w prowincji (wcześniej największą pojedynczą) — podział nie osłabia oblężeń; wynik identyczny jak przed zmianą dla pojedynczej armii.
- Testy: logika (podział/łączenie/walidacje), 6 lat symulacji z podziałami co 20 dni (0 błędów, brak NaN), identyczny postęp oblężenia 1 vs 2 armie, test UI w przeglądarce (klik, S, ½, C, marsz nowej połowy, brak błędów JS).
- Hooki testowe: `__test.split(armyId)`, `__test.merge(nazwaProwincji)`.

### Dzielenie — wybór co zrobić z połową (zmiana)
- Po S / „½” połowa jest zaznaczona i „oczekuje na decyzję”: panel pokazuje ramkę „Wybrano połowę armii (N ludzi)” z opcjami: kliknij prowincję = wyślij, „Zostaw tutaj” = zatwierdź podział, „Anuluj podział (Esc)” = połowa wraca do armii (morale = średnia ważona).
- Podział zatwierdza się też rozkazem marszu lub zaznaczeniem czegoś innego. Po zatwierdzeniu Esc tylko odznacza (nie cofa). Cofanie: `playerUndoSplit` w game.mjs.

## Bitwy wielodniowe (zmiana)
- **Naprawiony błąd:** `resolveBattles` grupował armie w strony odwrotnie (wroga wkładał na listę przeciwnika), więc wrogie armie w jednej prowincji w ogóle ze sobą nie walczyły — przenikały się („ping-pong”). Teraz sojusznicy/ten sam kraj tworzą jedną stronę, wrogowie osobne.
- **Bitwa = starcie na wiele dni** (`fightDay`/`endBattle`, stan w `G.battles`): codziennie obie strony tracą ludzi (3,5%/dzień × udział siły przeciwnika) i morale (słabsza szybciej). Kończy się, gdy morale strony < 0,25 lub liczebność < 150 (albo po 45 dniach). Typowo ~10 dni.
- W trakcie bitwy armie **nie maszerują** (rozkaz czeka) i **nie oblegają**; dołączające armie wchodzą do trwającej bitwy. Gracz: rozkaz marszu dla armii w walce = **odwrót** (−5% ludzi, −0,15 morale, wyjście od razu).
- Pokonany: pościg (−6% ludzi) i odwrót do następnej prowincji w stronę własnej; zwycięzca zostaje. Wynik wojny +5 +straty/60 za bitwę.
- **Morale się odbudowuje** (wcześniej nigdy): +0,02/dzień na własnym terenie, +0,008 poza nim; nie w walce i nie w okrążeniu.
- Odwrót pokonanych brał `path[0]` z `findPath`, a to prowincja startowa — naprawione (`path[1]`).
- UI: ⚔ i pasek przewagi stron nad prowincją z bitwą, ramka „Bitwa trwa” w panelu, wpisy w dzienniku (start i wynik, gdy dotyczy gracza), punkt w pomocy.
- Uwaga (stare zachowanie, nie ruszone): rozkazy marszu mają na początku ścieżki prowincję startową, więc każdy marsz zaczyna się od ~4 dni stania w miejscu.

## Rozmowy pokojowe w stylu Age of History 2 (zmiana)
- „Negocjuj pokój” otwiera **tryb pokoju na mapie** zamiast okna modalnego (ui.mjs: `openPeace`, `peace*`; render.mjs: `R.setPeace`, nakładka + plakietki; CSS `.pz-*`). Gra jest pauzowana na czas rozmów, zwykłe HUD ukryte (`body.peace-mode`).
- Mapa: prowincje do zażądania są kreskowane i mają plakietkę „N ★”, reszta zaciemniona; klik w prowincję (lub w pozycję listy) zaznacza ją na zielono. Najechanie pokazuje koszt w dymku.
- Belka u góry: „Rozmowy pokojowe — X% na korzyść Agresorów/Obrońców” (z punktów wojennych liderów). Lewy panel „Wynik”: punkty uczestników + pasek budżetu żądań (czerwony przy przekroczeniu). Prawy panel „Stwórz żądania”: sekcje per wróg — **Zażądaj wasalizacji**, **Reparacje wojenne** (suwak, 4 dukaty = 1 ★), lista prowincji z kosztami. Dół: „Wróć” (Esc), „Biały pokój”, „Wyślij żądania”.
- **Nowe: wasalizacja w traktacie** (`vassalCost`, `canVassalize`, `makeVassal` w diplo.mjs): tylko lider wojny, cel bez suwerena; koszt ≈ 60% sumy kosztów jego prowincji, liczony we wspólnej puli z prowincjami i reparacjami; wasalizacja wyklucza żądanie jego prowincji. `playerPeaceDemand(G, w, demands, gold, vassals)`.

## Rozbudowa mapy prowincji na podstawie mapy referencyjnej (14.11.2026)
- Zachowano zakres mapy i istniejące kraje/startowe posiadanie, ale podzielono duże obszary prowincji na mniejsze, spójne terytoria.
- Liczba prowincji wzrosła z **518 do 850** (+332; ok. 64%). Nowe granice powstały wewnątrz dotychczasowych prowincji, więc nie zmieniono właścicieli państw ani zasad rozgrywki.
- Przeliczono centra prowincji, sąsiedztwo lądowe i wybrzeża na podstawie nowej siatki; identyfikatory starych prowincji zachowano dla kompatybilności zapisów/systemów odwołań.
- Dodano `data/reference_map_1400.png` jako dołączoną mapę referencyjną użytkownika.
- Uwaga: jest to zagęszczenie podziału istniejącej mapy gry inspirowane mapą referencyjną, a nie ręczne odwzorowanie każdej historycznej granicy z obrazu. Mechaniki gry nie zmieniano.


## Czytelność mapy – 2026-11-14
- Ujednolicono kolor w obrębie każdego państwa: bez losowych odcieni i tintowania terenem.
- Przydzielono odrębne kolory 52 państwom.
- Włączono wygładzanie skalowania mapy.
- Etykiety państw są centrowane względem zajętego obszaru i automatycznie zmniejszane, aby mieściły się w granicach kraju.
