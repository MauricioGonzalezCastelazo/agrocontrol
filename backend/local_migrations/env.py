from alembic import context


def run():
    connection = context.config.attributes.get("connection")
    if connection is None:
        raise RuntimeError("Use python -m app.local.cli migrate; a local connection is required")
    context.configure(connection=connection, transactional_ddl=True)
    with context.begin_transaction():
        context.run_migrations()


run()
