import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from vinyl_tracker import concerts, discogs, report, spotify_history, stores
from vinyl_tracker.models import Album, StoreHit
from vinyl_tracker.text import album_key, clean_album

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 19, tzinfo=timezone.utc)


class TextTests(unittest.TestCase):
    def test_clean_album(self):
        self.assertEqual(clean_album("OK Computer (Remastered)"), "OK Computer")
        self.assertEqual(clean_album("Abbey Road - 2019 Remaster"), "Abbey Road")

    def test_key_merges_editions_and_accents(self):
        self.assertEqual(album_key("Rosalía", "Motomami (Deluxe)"), album_key("Rosalia", "MOTOMAMI"))


class HistoryTests(unittest.TestCase):
    def test_aggregates_filters_window_and_merges_remaster(self):
        albums, s = spotify_history.load_history(FIX, days=365, now=NOW)
        by = {a.album: a for a in albums.values()}
        self.assertNotIn("Gone", by)                      # fuera de la ventana
        self.assertEqual(s["sin_album"], 1)               # podcast sin álbum
        ok = [a for a in albums.values() if a.artist == "Radiohead"]
        self.assertEqual(len(ok), 1)                      # Remastered + normal = 1
        self.assertEqual(ok[0].plays, 35)
        self.assertEqual(by["Nevermind"].tracks, 10)

    def test_all_time(self):
        albums, _ = spotify_history.load_history(FIX, days=None, now=NOW)
        self.assertIn(album_key("Old", "Gone"), albums)


class StoreTests(unittest.TestCase):
    def prod(self, title, ptype="Vinilo", tags=(), avail=True, price="20.00", vendor="Nirvana"):
        return {"title": title, "handle": title.lower().replace(" ", "-"), "vendor": vendor,
                "product_type": ptype, "tags": list(tags), "body_html": "<p>Lanzamiento el 5 de marzo de 2027</p>",
                "variants": [{"price": price, "available": avail}]}

    def test_match_only_vinyl_and_detect_preorder(self):
        base = "https://x.test"
        idx = stores.index_catalog([
            self.prod("Nevermind - Vinilo", tags=["Preventa"]),
            self.prod("Nevermind - CD", ptype="CD"),
            self.prod("Camiseta Nirvana", ptype="Ropa", vendor="Nirvana")])
        hits = stores.match(Album("Nirvana", "Nevermind"), idx, "X", base)
        self.assertEqual(len(hits), 1)
        self.assertTrue(hits[0].preorder)
        self.assertEqual(hits[0].release_date, "2027-03-05")
        self.assertEqual(hits[0].price, 20.0)

    def test_no_match_other_artist(self):
        idx = stores.index_catalog([self.prod("Pure - Vinilo", vendor="Delta Goodrem")])
        self.assertEqual(stores.match(Album("Nirvana", "Pure"), idx, "X", "https://x.test"), [])


class DiscogsTests(unittest.TestCase):
    def test_pick_release_prefers_popular_and_rejects_wrong(self):
        res = [{"id": 1, "title": "Nirvana - Nevermind", "community": {"have": 10}},
               {"id": 2, "title": "Nirvana - Nevermind", "community": {"have": 5000}},
               {"id": 3, "title": "Other - Thing", "community": {"have": 99999}}]
        self.assertEqual(discogs.pick_release(res, "Nirvana", "Nevermind (Deluxe)")["id"], 2)
        self.assertIsNone(discogs.pick_release(res, "Nobody", "Nothing"))


class ReportTests(unittest.TestCase):
    def test_total_excludes_owned_and_outputs_files(self):
        a = Album("A", "One", discogs_lowest=10.0)
        b = Album("B", "Two", discogs_lowest=99.0, owned=True)
        c = Album("C", "Three", discogs_lowest=50.0)
        c.offers.append(StoreHit("S", "t", 30.0, True, False, "https://s/x"))
        self.assertEqual(report.estimate(c), 30.0)
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            files = report.write_all([a, b, c], Path(d), {"currency": "EUR", "fuentes": []})
            md = (Path(d) / "informe.md").read_text()
            self.assertIn("40.00 EUR", md)       # 10 + 30, sin el que ya tienes
            self.assertEqual(len(files), 3)


if __name__ == "__main__":
    unittest.main()


class ConcertTests(unittest.TestCase):
    @staticmethod
    def ev(i, date="2027-03-12", name="X en directo", acts=("X",), code="onsale", cc="ES"):
        return {"id": i, "name": name, "url": "https://tm/" + i,
                "dates": {"start": {"localDate": date, "localTime": "21:00:00"}, "status": {"code": code}},
                "_embedded": {"attractions": [{"name": a} for a in acts],
                              "venues": [{"name": "Sala", "city": {"name": "Madrid"}, "country": {"countryCode": cc}}]}}

    def test_compact_filters_cancelled_and_no_artist(self):
        self.assertEqual(concerts.compact(self.ev("a"))[:5], ["a", "X en directo", "2027-03-12", "21:00", "ok"])
        self.assertIsNone(concerts.compact(self.ev("b", code="cancelled")))
        self.assertIsNone(concerts.compact(self.ev("c", acts=())))
        self.assertEqual(concerts.compact(self.ev("d", code="rescheduled"))[4], "postponed")

    def test_window_splits_when_over_1000_and_dedups(self):
        calls = []

        def fake(url, params):
            calls.append(params)
            span = (datetime.strptime(params["endDateTime"], "%Y-%m-%dT%H:%M:%SZ")
                    - datetime.strptime(params["startDateTime"], "%Y-%m-%dT%H:%M:%SZ")).days
            if span > 100:      # ventana grande: demasiados resultados
                return {"page": {"totalElements": 1500, "totalPages": 5}, "_embedded": {"events": [self.ev("big")]}}
            return {"page": {"totalElements": 2, "totalPages": 1}, "_embedded": {"events": [self.ev("s%d" % span), self.ev("dup")]}}

        out = concerts.build("K", ["ES", "PT"], days=365, now=datetime(2026, 11, 20, tzinfo=timezone.utc), get=fake, sleep=lambda s: None, log=lambda m: None)
        ids = [e[0] for e in out["events"]]
        self.assertEqual(len(ids), len(set(ids)))              # sin repetidos (ni entre países)
        self.assertIn("dup", ids)
        self.assertEqual(out["countries"], ["ES", "PT"])
        self.assertTrue(all(c["apikey"] == "K" for c in calls))
        self.assertGreater(len(calls), 4)                       # se partió la ventana

    def test_failed_country_is_skipped(self):
        def boom(url, params):
            raise concerts.HttpError(500, url)
        out = concerts.build("K", ["ES"], get=boom, sleep=lambda s: None, log=lambda m: None)
        self.assertEqual(out["countries"], []); self.assertEqual(out["events"], [])
