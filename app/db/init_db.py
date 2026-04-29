import psycopg2
import os

def run_db_init():
    db_url = os.getenv("DATABASE_URL")

    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            with open("app/db/init-db.sql", "r") as f:
                sql = f.read()
                cur.execute(sql)

    print("✅ DB initialized")