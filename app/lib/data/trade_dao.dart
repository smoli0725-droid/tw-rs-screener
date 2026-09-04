import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import '../domain/models.dart';

class TradeDao {
  Database? _db;

  Future<Database> get db async {
    if (_db != null) return _db!;
    final dir = await getApplicationDocumentsDirectory();
    _db = await openDatabase(
      p.join(dir.path, 'taiwan_rs.db'),
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT NOT NULL,
            market TEXT NOT NULL,
            side TEXT NOT NULL,
            date TEXT NOT NULL,
            price REAL NOT NULL,
            shares INTEGER NOT NULL,
            fee REAL NOT NULL DEFAULT 0,
            note TEXT
          )
        ''');
      },
    );
    return _db!;
  }

  Future<List<Trade>> all() async {
    final rows = await (await db).query('trades', orderBy: 'date ASC, id ASC');
    return rows.map(Trade.fromMap).toList();
  }

  Future<int> insert(Trade t) async => (await db).insert('trades', t.toMap());

  Future<int> update(Trade t) async =>
      (await db).update('trades', t.toMap(), where: 'id = ?', whereArgs: [t.id]);

  Future<int> delete(int id) async =>
      (await db).delete('trades', where: 'id = ?', whereArgs: [id]);
}
