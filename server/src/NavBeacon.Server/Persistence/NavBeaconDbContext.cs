using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace NavBeacon.Server.Persistence;

public sealed class NavBeaconDbContext(DbContextOptions<NavBeaconDbContext> options)
  : DbContext(options), IDataProtectionKeyContext
{
  public DbSet<CommanderAccount> CommanderAccounts => Set<CommanderAccount>();

  public DbSet<OAuthAttempt> OAuthAttempts => Set<OAuthAttempt>();

  public DbSet<CommanderSession> Sessions => Set<CommanderSession>();

  public DbSet<SynchronisedRecord> SynchronisedRecords => Set<SynchronisedRecord>();

  public DbSet<OwnedShip> OwnedShips => Set<OwnedShip>();

  public DbSet<JournalCursor> JournalCursors => Set<JournalCursor>();

  public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

  protected override void OnModelCreating(ModelBuilder modelBuilder)
  {
    modelBuilder.Entity<CommanderAccount>(entity =>
    {
      entity.ToTable("commander_accounts", table =>
      {
        table.HasCheckConstraint("ck_commander_accounts_name", "char_length(commander_name) > 0");
        table.HasCheckConstraint("ck_commander_accounts_revision", "record_revision >= 0");
      });
      entity.HasKey(account => account.CustomerId);
      entity.Property(account => account.CustomerId).ValueGeneratedNever();
      entity.Property(account => account.CommanderName).HasMaxLength(128);
      entity.Property(account => account.ProtectedAccessToken).HasColumnType("text");
      entity.Property(account => account.ProtectedRefreshToken).HasColumnType("text");
    });

    modelBuilder.Entity<OAuthAttempt>(entity =>
    {
      entity.ToTable("oauth_attempts");
      entity.HasKey(attempt => attempt.StateHash);
      entity.Property(attempt => attempt.StateHash).HasMaxLength(32);
      entity.Property(attempt => attempt.BrowserCorrelationHash).HasMaxLength(32);
      entity.HasIndex(attempt => attempt.BrowserCorrelationHash).IsUnique();
      // A sign-in start and every callback delete expired rows, so that sweep
      // must not read the table.
      entity.HasIndex(attempt => attempt.ExpiresAt);
    });

    modelBuilder.Entity<CommanderSession>(entity =>
    {
      entity.ToTable("commander_sessions", table =>
      {
        table.HasCheckConstraint(
          "ck_commander_sessions_lifetime",
          "created_at <= last_renewed_at AND last_renewed_at < absolute_expires_at "
            + "AND renewable_expires_at > last_renewed_at "
            + "AND renewable_expires_at <= absolute_expires_at "
            + "AND renewable_expires_at <= last_renewed_at + interval '30 days' "
            + "AND absolute_expires_at = created_at + interval '180 days'"
        );
      });
      entity.HasKey(session => session.SessionHash);
      entity.Property(session => session.SessionHash).HasMaxLength(32);
      // Every protected request sweeps expired sessions, which is the hottest
      // path the server has.
      entity.HasIndex(session => session.RenewableExpiresAt);
      entity.HasIndex(session => session.AbsoluteExpiresAt);
      entity
        .HasOne(session => session.Account)
        .WithMany(account => account.Sessions)
        .HasForeignKey(session => session.CustomerId)
        .OnDelete(DeleteBehavior.Cascade);
    });

    modelBuilder.Entity<SynchronisedRecord>(entity =>
    {
      entity.ToTable("synchronised_records", table =>
      {
        table.HasCheckConstraint("ck_synchronised_records_revision", "revision > 0");
        table.HasCheckConstraint(
          "ck_synchronised_records_exact_shape",
          "(payload IS NULL AND record_kind IS NULL AND created_at IS NULL "
            + "AND browser_modified_at IS NULL AND server_content_at IS NULL "
            + "AND protection_deadline IS NULL) "
            + "OR (payload IS NOT NULL AND record_kind IS NOT NULL AND created_at IS NOT NULL "
            + "AND browser_modified_at IS NOT NULL AND server_content_at IS NOT NULL)"
        );
      });
      entity.HasKey(record => new { record.CustomerId, record.RecordId });
      entity.Property(record => record.Payload).HasColumnType("jsonb");
      entity.Property(record => record.RecordKind).HasMaxLength(32);
      entity.HasIndex(record => new { record.CustomerId, record.Revision }).IsUnique();
      entity
        .HasOne(record => record.Account)
        .WithMany(account => account.SynchronisedRecords)
        .HasForeignKey(record => record.CustomerId)
        .OnDelete(DeleteBehavior.Cascade);
    });

    modelBuilder.Entity<OwnedShip>(entity =>
    {
      entity.ToTable("owned_ships", table =>
      {
        table.HasCheckConstraint("ck_owned_ships_source_line", "source_line >= 0");
      });
      entity.HasKey(ship => new { ship.CustomerId, ship.ShipId });
      entity.Property(ship => ship.Payload).HasColumnType("jsonb");
      entity.HasIndex(ship => new { ship.CustomerId, ship.SourceDate, ship.SourceLine }).IsUnique();
      entity
        .HasOne(ship => ship.Account)
        .WithMany(account => account.OwnedShips)
        .HasForeignKey(ship => ship.CustomerId)
        .OnDelete(DeleteBehavior.Cascade);
    });

    modelBuilder.Entity<JournalCursor>(entity =>
    {
      entity.ToTable("journal_cursors", table =>
      {
        table.HasCheckConstraint(
          "ck_journal_cursors_lines",
          "next_unread_line >= 0 AND (last_stored_ships_line IS NULL OR last_stored_ships_line >= 0)"
        );
        table.HasCheckConstraint(
          "ck_journal_cursors_stored_ships",
          "(last_stored_ships_date IS NULL AND last_stored_ships_line IS NULL "
            + "AND last_stored_ships_complete IS NULL) "
            + "OR (last_stored_ships_date IS NOT NULL AND last_stored_ships_line IS NOT NULL "
            + "AND last_stored_ships_complete IS NOT NULL)"
        );
      });
      entity.HasKey(cursor => cursor.CustomerId);
      entity.Property(cursor => cursor.CustomerId).ValueGeneratedNever();
      entity
        .HasOne(cursor => cursor.Account)
        .WithOne(account => account.JournalCursor)
        .HasForeignKey<JournalCursor>(cursor => cursor.CustomerId)
        .OnDelete(DeleteBehavior.Cascade);
    });

    modelBuilder.Entity<DataProtectionKey>(entity =>
    {
      entity.ToTable("data_protection_keys");
      entity.HasKey(key => key.Id);
      entity.Property(key => key.FriendlyName).HasMaxLength(256);
      entity.Property(key => key.Xml).HasColumnType("text");
    });

    ApplySnakeCaseNames(modelBuilder);
  }

  private static void ApplySnakeCaseNames(ModelBuilder modelBuilder)
  {
    foreach (var entity in modelBuilder.Model.GetEntityTypes())
    {
      foreach (var property in entity.GetProperties())
      {
        property.SetColumnName(ToSnakeCase(property.GetColumnName()));
      }
    }
  }

  private static string ToSnakeCase(string value)
  {
    return string.Concat(
      value.Select((character, index) =>
        char.IsUpper(character) && index > 0
          ? $"_{char.ToLowerInvariant(character)}"
          : char.ToLowerInvariant(character).ToString()
      )
    );
  }
}
