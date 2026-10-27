/// <reference path="../pb_data/types.d.ts" />
// Схема «Калорий»: цель в профиле, общая база продуктов, дневник каждого пользователя.
migrate((db) => {
  const dao = new Dao(db);
  const num = (name, max) => ({ name, type: "number", options: { min: 0, max: max || 100000 } });
  const text = (name, max, required) => ({ name, type: "text", required: !!required, options: { max: max || 200 } });

  const users = dao.findCollectionByNameOrId("users");
  users.schema.addField(new SchemaField(num("goal", 20000)));
  dao.saveCollection(users);

  // Общая база: видят все вошедшие, править может только автор
  const foods = new Collection({
    name: "foods",
    type: "base",
    schema: [
      text("name", 200, true),
      text("brand", 80),
      text("code", 32),
      num("kcal", 1000), num("p", 1000), num("f", 1000), num("c", 1000), num("serving", 10000),
      { name: "author", type: "relation", required: true, options: { collectionId: users.id, maxSelect: 1, cascadeDelete: false } },
    ],
    indexes: ["CREATE INDEX idx_foods_code ON foods (code)", "CREATE INDEX idx_foods_name ON foods (name)"],
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.id != '' && author = @request.auth.id",
    updateRule: "author = @request.auth.id",
    deleteRule: "author = @request.auth.id",
  });
  dao.saveCollection(foods);

  // Дневник: записи видит и меняет только владелец
  const entries = new Collection({
    name: "entries",
    type: "base",
    schema: [
      { name: "user", type: "relation", required: true, options: { collectionId: users.id, maxSelect: 1, cascadeDelete: true } },
      text("day", 10, true),
      { name: "meal", type: "select", required: true, options: { maxSelect: 1, values: ["breakfast", "lunch", "dinner", "snack"] } },
      num("grams", 100000),
      text("name", 200, true),
      text("brand", 80),
      text("fkey", 64),
      num("kcal", 1000), num("p", 1000), num("f", 1000), num("c", 1000),
    ],
    indexes: ["CREATE INDEX idx_entries_user_day ON entries (user, day)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: "@request.auth.id != '' && user = @request.auth.id",
    updateRule: "user = @request.auth.id && @request.data.user:isset = false",
    deleteRule: "user = @request.auth.id",
  });
  dao.saveCollection(entries);
}, (db) => {
  const dao = new Dao(db);
  for (const name of ["entries", "foods"]) {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const users = dao.findCollectionByNameOrId("users");
  users.schema.removeField(users.schema.getFieldByName("goal").id);
  dao.saveCollection(users);
});
