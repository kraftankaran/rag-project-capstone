import os
import logging
from psycopg2.pool import SimpleConnectionPool

logger = logging.getLogger(__name__)


class Database:
    _pool = None

    @classmethod
    def initialize(cls):
        if cls._pool is None:
            dsn = os.getenv("DATABASE_URL")
            if not dsn:
                raise RuntimeError("DATABASE_URL is not set")

            logger.info(f"Connecting to DB: {dsn}")

            cls._pool = SimpleConnectionPool(
                minconn=1,
                maxconn=10,
                dsn=dsn
            )
            logger.info("DB connection pool created")

    @classmethod
    def get_connection(cls):
        if cls._pool is None:
            cls.initialize()
        return cls._pool.getconn()

    @classmethod
    def return_connection(cls, conn):
        if cls._pool and conn:
            cls._pool.putconn(conn)

    @classmethod
    def close_all(cls):
        if cls._pool:
            cls._pool.closeall()
            cls._pool = None
            logger.info("DB connection pool closed")
