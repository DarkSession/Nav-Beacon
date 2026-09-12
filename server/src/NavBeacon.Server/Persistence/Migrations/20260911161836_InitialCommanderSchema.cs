using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NavBeacon.Server.Persistence.Migrations
{
  /// <inheritdoc />
  public partial class InitialCommanderSchema : Migration
  {
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
      migrationBuilder.CreateTable(
          name: "commander_accounts",
          columns: table => new
          {
            customer_id = table.Column<long>(type: "bigint", nullable: false),
            commander_name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
            protected_access_token = table.Column<string>(type: "text", nullable: false),
            protected_refresh_token = table.Column<string>(type: "text", nullable: false),
            access_token_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            record_revision = table.Column<long>(type: "bigint", nullable: false)
          },
          constraints: table =>
          {
            table.PrimaryKey("PK_commander_accounts", x => x.customer_id);
            table.CheckConstraint("ck_commander_accounts_name", "char_length(commander_name) > 0");
            table.CheckConstraint("ck_commander_accounts_revision", "record_revision >= 0");
          });

      migrationBuilder.CreateTable(
          name: "data_protection_keys",
          columns: table => new
          {
            id = table.Column<int>(type: "integer", nullable: false)
                  .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
            friendly_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
            xml = table.Column<string>(type: "text", nullable: true)
          },
          constraints: table =>
          {
            table.PrimaryKey("PK_data_protection_keys", x => x.id);
          });

      migrationBuilder.CreateTable(
          name: "oauth_attempts",
          columns: table => new
          {
            state_hash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
            browser_correlation_hash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
            expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
          },
          constraints: table =>
          {
            table.PrimaryKey("PK_oauth_attempts", x => x.state_hash);
          });

      migrationBuilder.CreateTable(
          name: "commander_sessions",
          columns: table => new
          {
            session_hash = table.Column<byte[]>(type: "bytea", maxLength: 32, nullable: false),
            customer_id = table.Column<long>(type: "bigint", nullable: false),
            created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            last_renewed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            renewable_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            absolute_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
          },
          constraints: table =>
          {
            table.PrimaryKey("PK_commander_sessions", x => x.session_hash);
            table.CheckConstraint("ck_commander_sessions_lifetime", "created_at <= last_renewed_at AND last_renewed_at < absolute_expires_at AND renewable_expires_at > last_renewed_at AND renewable_expires_at <= absolute_expires_at AND renewable_expires_at <= last_renewed_at + interval '30 days' AND absolute_expires_at = created_at + interval '180 days'");
            table.ForeignKey(
                      name: "FK_commander_sessions_commander_accounts_customer_id",
                      column: x => x.customer_id,
                      principalTable: "commander_accounts",
                      principalColumn: "customer_id",
                      onDelete: ReferentialAction.Cascade);
          });

      migrationBuilder.CreateTable(
          name: "journal_cursors",
          columns: table => new
          {
            customer_id = table.Column<long>(type: "bigint", nullable: false),
            coverage_start_date = table.Column<DateOnly>(type: "date", nullable: false),
            next_unread_date = table.Column<DateOnly>(type: "date", nullable: false),
            next_unread_line = table.Column<int>(type: "integer", nullable: false),
            last_stored_ships_date = table.Column<DateOnly>(type: "date", nullable: true),
            last_stored_ships_line = table.Column<int>(type: "integer", nullable: true),
            last_stored_ships_complete = table.Column<bool>(type: "boolean", nullable: true),
            next_permitted_refresh_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
          },
          constraints: table =>
          {
            table.PrimaryKey("PK_journal_cursors", x => x.customer_id);
            table.CheckConstraint("ck_journal_cursors_lines", "next_unread_line >= 0 AND (last_stored_ships_line IS NULL OR last_stored_ships_line >= 0)");
            table.CheckConstraint("ck_journal_cursors_stored_ships", "(last_stored_ships_date IS NULL AND last_stored_ships_line IS NULL AND last_stored_ships_complete IS NULL) OR (last_stored_ships_date IS NOT NULL AND last_stored_ships_line IS NOT NULL AND last_stored_ships_complete IS NOT NULL)");
            table.ForeignKey(
                      name: "FK_journal_cursors_commander_accounts_customer_id",
                      column: x => x.customer_id,
                      principalTable: "commander_accounts",
                      principalColumn: "customer_id",
                      onDelete: ReferentialAction.Cascade);
          });

      migrationBuilder.CreateTable(
          name: "owned_ships",
          columns: table => new
          {
            customer_id = table.Column<long>(type: "bigint", nullable: false),
            ship_id = table.Column<long>(type: "bigint", nullable: false),
            source_date = table.Column<DateOnly>(type: "date", nullable: false),
            source_line = table.Column<int>(type: "integer", nullable: false),
            payload = table.Column<string>(type: "jsonb", nullable: false)
          },
          constraints: table =>
          {
            table.PrimaryKey("PK_owned_ships", x => new { x.customer_id, x.ship_id });
            table.CheckConstraint("ck_owned_ships_source_line", "source_line >= 0");
            table.ForeignKey(
                      name: "FK_owned_ships_commander_accounts_customer_id",
                      column: x => x.customer_id,
                      principalTable: "commander_accounts",
                      principalColumn: "customer_id",
                      onDelete: ReferentialAction.Cascade);
          });

      migrationBuilder.CreateTable(
          name: "synchronised_records",
          columns: table => new
          {
            customer_id = table.Column<long>(type: "bigint", nullable: false),
            record_id = table.Column<Guid>(type: "uuid", nullable: false),
            revision = table.Column<long>(type: "bigint", nullable: false),
            payload = table.Column<string>(type: "jsonb", nullable: true),
            record_kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
            created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
            browser_modified_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
            server_content_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
            protection_deadline = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
          },
          constraints: table =>
          {
            table.PrimaryKey("PK_synchronised_records", x => new { x.customer_id, x.record_id });
            table.CheckConstraint("ck_synchronised_records_exact_shape", "(payload IS NULL AND record_kind IS NULL AND created_at IS NULL AND browser_modified_at IS NULL AND server_content_at IS NULL AND protection_deadline IS NULL) OR (payload IS NOT NULL AND record_kind IS NOT NULL AND created_at IS NOT NULL AND browser_modified_at IS NOT NULL AND server_content_at IS NOT NULL)");
            table.CheckConstraint("ck_synchronised_records_revision", "revision > 0");
            table.ForeignKey(
                      name: "FK_synchronised_records_commander_accounts_customer_id",
                      column: x => x.customer_id,
                      principalTable: "commander_accounts",
                      principalColumn: "customer_id",
                      onDelete: ReferentialAction.Cascade);
          });

      migrationBuilder.CreateIndex(
          name: "IX_commander_sessions_absolute_expires_at",
          table: "commander_sessions",
          column: "absolute_expires_at");

      migrationBuilder.CreateIndex(
          name: "IX_commander_sessions_customer_id",
          table: "commander_sessions",
          column: "customer_id");

      migrationBuilder.CreateIndex(
          name: "IX_commander_sessions_renewable_expires_at",
          table: "commander_sessions",
          column: "renewable_expires_at");

      migrationBuilder.CreateIndex(
          name: "IX_oauth_attempts_browser_correlation_hash",
          table: "oauth_attempts",
          column: "browser_correlation_hash",
          unique: true);

      migrationBuilder.CreateIndex(
          name: "IX_oauth_attempts_expires_at",
          table: "oauth_attempts",
          column: "expires_at");

      migrationBuilder.CreateIndex(
          name: "IX_owned_ships_customer_id_source_date_source_line",
          table: "owned_ships",
          columns: new[] { "customer_id", "source_date", "source_line" },
          unique: true);

      migrationBuilder.CreateIndex(
          name: "IX_synchronised_records_customer_id_revision",
          table: "synchronised_records",
          columns: new[] { "customer_id", "revision" },
          unique: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
      migrationBuilder.DropTable(
          name: "commander_sessions");

      migrationBuilder.DropTable(
          name: "data_protection_keys");

      migrationBuilder.DropTable(
          name: "journal_cursors");

      migrationBuilder.DropTable(
          name: "oauth_attempts");

      migrationBuilder.DropTable(
          name: "owned_ships");

      migrationBuilder.DropTable(
          name: "synchronised_records");

      migrationBuilder.DropTable(
          name: "commander_accounts");
    }
  }
}
