import androidx.sqlite.driver.bundled.BundledSQLiteDriver;
import androidx.sqlite.SQLite;
var c = new BundledSQLiteDriver().open(":memory:");
var s = c.prepare("select sqlite_version()"); s.step(); System.out.println("version=" + s.getText(0)); s.close();
SQLite.execSQL(c, "CREATE TABLE article(itemId TEXT PRIMARY KEY, title TEXT NOT NULL, text TEXT)");
SQLite.execSQL(c, "CREATE VIRTUAL TABLE article_fts USING FTS4(itemId TEXT NOT NULL, title TEXT NOT NULL, text TEXT, content=`article`)");
SQLite.execSQL(c, "INSERT INTO article VALUES('a1','Gardening with roses','some text')");
SQLite.execSQL(c, "INSERT INTO article_fts(article_fts) VALUES('rebuild')");
var q = c.prepare("SELECT itemId FROM article_fts WHERE article_fts MATCH ?"); q.bindText(1, "*\"*roses*\"*"); while (q.step()) System.out.println("fts4 hit=" + q.getText(0)); q.close();
SQLite.execSQL(c, "CREATE VIRTUAL TABLE f5 USING fts5(title, tokenize='porter unicode61 remove_diacritics 2')");
SQLite.execSQL(c, "INSERT INTO f5 VALUES('Running shoes')");
var r = c.prepare("SELECT title, bm25(f5) FROM f5 WHERE f5 MATCH 'run'"); while (r.step()) System.out.println("fts5 hit=" + r.getText(0)); r.close();
c.close();
/exit
