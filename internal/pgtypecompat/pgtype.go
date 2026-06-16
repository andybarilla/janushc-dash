package pgtype

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"time"

	pgxpgtype "github.com/jackc/pgx/v5/pgtype"
)

type Date = pgxpgtype.Date
type InfinityModifier = pgxpgtype.InfinityModifier
type Int4 = pgxpgtype.Int4
type Int8 = pgxpgtype.Int8
type Numeric = pgxpgtype.Numeric
type Text = pgxpgtype.Text
type UUID = pgxpgtype.UUID

type JSONB []byte

func (j *JSONB) Scan(src any) error {
	switch value := src.(type) {
	case nil:
		*j = nil
		return nil
	case string:
		*j = append((*j)[:0], value...)
		return nil
	case []byte:
		*j = append((*j)[:0], value...)
		return nil
	}
	return fmt.Errorf("cannot scan JSONB from %T", src)
}

func (j JSONB) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return []byte(j), nil
}

func (j JSONB) MarshalJSON() ([]byte, error) {
	if j == nil {
		return []byte("null"), nil
	}
	return j, nil
}

func (j *JSONB) UnmarshalJSON(bytes []byte) error {
	*j = append((*j)[:0], bytes...)
	return nil
}

type Timestamptz struct {
	Time             time.Time
	InfinityModifier InfinityModifier
	Valid            bool
}

func (tstz *Timestamptz) Scan(src any) error {
	var pgxValue pgxpgtype.Timestamptz
	if err := pgxValue.Scan(src); err == nil {
		*tstz = fromPGXTimestamptz(pgxValue)
		return nil
	}

	switch value := src.(type) {
	case string:
		return tstz.scanSQLiteTimestamp(value)
	case []byte:
		return tstz.scanSQLiteTimestamp(string(value))
	}

	return pgxValue.Scan(src)
}

func (tstz *Timestamptz) scanSQLiteTimestamp(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		*tstz = Timestamptz{}
		return nil
	}

	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05.999999999",
		"2006-01-02T15:04:05",
	} {
		parsed, err := time.ParseInLocation(layout, value, time.UTC)
		if err == nil {
			*tstz = Timestamptz{Time: parsed, Valid: true}
			return nil
		}
	}

	return fmt.Errorf("cannot scan TIMESTAMPTZ from %q", value)
}

func (tstz *Timestamptz) ScanTimestamptz(value Timestamptz) error {
	*tstz = value
	return nil
}

func (tstz Timestamptz) TimestamptzValue() (Timestamptz, error) {
	return tstz, nil
}

func (tstz Timestamptz) Value() (driver.Value, error) {
	return tstz.toPGX().Value()
}

func (tstz Timestamptz) MarshalJSON() ([]byte, error) {
	return tstz.toPGX().MarshalJSON()
}

func (tstz *Timestamptz) UnmarshalJSON(bytes []byte) error {
	var pgxValue pgxpgtype.Timestamptz
	if err := pgxValue.UnmarshalJSON(bytes); err != nil {
		return err
	}
	*tstz = fromPGXTimestamptz(pgxValue)
	return nil
}

func (tstz Timestamptz) toPGX() pgxpgtype.Timestamptz {
	return pgxpgtype.Timestamptz{
		Time:             tstz.Time,
		InfinityModifier: tstz.InfinityModifier,
		Valid:            tstz.Valid,
	}
}

func fromPGXTimestamptz(tstz pgxpgtype.Timestamptz) Timestamptz {
	return Timestamptz{
		Time:             tstz.Time,
		InfinityModifier: tstz.InfinityModifier,
		Valid:            tstz.Valid,
	}
}
