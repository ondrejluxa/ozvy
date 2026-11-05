export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_generations: {
        Row: {
          campaign_id: string | null;
          chosen_index: number | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          input: NonNullable<Json>;
          kind: string;
          model: string;
          output: Json | null;
          prompt_version: string;
          tokens_in: number | null;
          tokens_out: number | null;
        };
        Insert: {
          campaign_id?: string | null;
          chosen_index?: number | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          input: NonNullable<Json>;
          kind: string;
          model: string;
          output?: Json | null;
          prompt_version: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
        };
        Update: {
          campaign_id?: string | null;
          chosen_index?: number | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          input?: NonNullable<Json>;
          kind?: string;
          model?: string;
          output?: Json | null;
          prompt_version?: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_generations_campaign_id_company_id_fkey";
            columns: ["campaign_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "ai_generations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      alerts: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          company_id: string | null;
          created_at: string;
          dedupe_key: string;
          detail: NonNullable<Json>;
          id: string;
          resolved_at: string | null;
          severity: string;
          status: string;
          title: string;
          type: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          company_id?: string | null;
          created_at?: string;
          dedupe_key: string;
          detail?: NonNullable<Json>;
          id?: string;
          resolved_at?: string | null;
          severity: string;
          status?: string;
          title: string;
          type: string;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          company_id?: string | null;
          created_at?: string;
          dedupe_key?: string;
          detail?: NonNullable<Json>;
          id?: string;
          resolved_at?: string | null;
          severity?: string;
          status?: string;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_type: string;
          actor_user_id: string | null;
          company_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: number;
          ip: unknown;
          metadata: NonNullable<Json>;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_type: string;
          actor_user_id?: string | null;
          company_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          ip?: unknown;
          metadata?: NonNullable<Json>;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_type?: string;
          actor_user_id?: string | null;
          company_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          ip?: unknown;
          metadata?: NonNullable<Json>;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_enrollments: {
        Row: {
          campaign_id: string;
          company_id: string;
          created_at: string;
          customer_id: string;
          first_sent_at: string | null;
          id: string;
          is_holdout: boolean;
          stage: Database["public"]["Enums"]["conversion_stage"];
          stopped_reason: string | null;
          updated_at: string;
          vehicle_id: string | null;
          window_ends_at: string | null;
        };
        Insert: {
          campaign_id: string;
          company_id: string;
          created_at?: string;
          customer_id: string;
          first_sent_at?: string | null;
          id?: string;
          is_holdout?: boolean;
          stage?: Database["public"]["Enums"]["conversion_stage"];
          stopped_reason?: string | null;
          updated_at?: string;
          vehicle_id?: string | null;
          window_ends_at?: string | null;
        };
        Update: {
          campaign_id?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          first_sent_at?: string | null;
          id?: string;
          is_holdout?: boolean;
          stage?: Database["public"]["Enums"]["conversion_stage"];
          stopped_reason?: string | null;
          updated_at?: string;
          vehicle_id?: string | null;
          window_ends_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_enrollments_campaign_id_company_id_fkey";
            columns: ["campaign_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "campaign_enrollments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_enrollments_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "campaign_enrollments_vehicle_id_company_id_fkey";
            columns: ["vehicle_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      campaign_steps: {
        Row: {
          body_template: string;
          campaign_id: string;
          company_id: string;
          created_at: string;
          delay_days: number;
          id: string;
          step_number: number;
          strip_diacritics: boolean;
        };
        Insert: {
          body_template: string;
          campaign_id: string;
          company_id: string;
          created_at?: string;
          delay_days?: number;
          id?: string;
          step_number: number;
          strip_diacritics?: boolean;
        };
        Update: {
          body_template?: string;
          campaign_id?: string;
          company_id?: string;
          created_at?: string;
          delay_days?: number;
          id?: string;
          step_number?: number;
          strip_diacritics?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_steps_campaign_id_company_id_fkey";
            columns: ["campaign_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      campaigns: {
        Row: {
          approval_comment: string | null;
          approved_at: string | null;
          approved_by: string | null;
          approved_recipient_count: number | null;
          attribution_window_days: number;
          automation_rule_id: string | null;
          avg_job_value_minor_snapshot: number | null;
          channel: string;
          company_id: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          expected_conversion_rate: number;
          holdout_pct: number;
          id: string;
          name: string;
          offer_text: string | null;
          scheduled_at: string | null;
          segment_id: string | null;
          segment_preset: string | null;
          segment_rules_snapshot: NonNullable<Json>;
          started_at: string | null;
          status: Database["public"]["Enums"]["campaign_status"];
          status_reason: string | null;
          submitted_at: string | null;
          submitted_by: string | null;
          updated_at: string;
        };
        Insert: {
          approval_comment?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_recipient_count?: number | null;
          attribution_window_days?: number;
          automation_rule_id?: string | null;
          avg_job_value_minor_snapshot?: number | null;
          channel?: string;
          company_id: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          expected_conversion_rate?: number;
          holdout_pct?: number;
          id?: string;
          name: string;
          offer_text?: string | null;
          scheduled_at?: string | null;
          segment_id?: string | null;
          segment_preset?: string | null;
          segment_rules_snapshot: NonNullable<Json>;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["campaign_status"];
          status_reason?: string | null;
          submitted_at?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Update: {
          approval_comment?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          approved_recipient_count?: number | null;
          attribution_window_days?: number;
          automation_rule_id?: string | null;
          avg_job_value_minor_snapshot?: number | null;
          channel?: string;
          company_id?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          expected_conversion_rate?: number;
          holdout_pct?: number;
          id?: string;
          name?: string;
          offer_text?: string | null;
          scheduled_at?: string | null;
          segment_id?: string | null;
          segment_preset?: string | null;
          segment_rules_snapshot?: NonNullable<Json>;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["campaign_status"];
          status_reason?: string | null;
          submitted_at?: string | null;
          submitted_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaigns_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaigns_segment_id_company_id_fkey";
            columns: ["segment_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "segments";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      companies: {
        Row: {
          address_line: string | null;
          average_job_value_minor: number;
          city: string | null;
          closed_at: string | null;
          contact_person: string | null;
          country: string;
          created_at: string;
          default_locale: string;
          default_sender_name: string | null;
          dic: string | null;
          dpa_document_path: string | null;
          dpa_signed_at: string | null;
          email: string | null;
          ico: string | null;
          id: string;
          lifecycle_computed_at: string | null;
          logo_path: string | null;
          name: string;
          opening_hours: NonNullable<Json>;
          phone: string | null;
          postal_code: string | null;
          preferred_channel: string;
          requires_client_approval: boolean;
          sending_enabled: boolean;
          service_mode: Database["public"]["Enums"]["service_mode"];
          settings: NonNullable<Json>;
          status: string;
          subscription_price_minor: number;
          timezone: string;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          address_line?: string | null;
          average_job_value_minor?: number;
          city?: string | null;
          closed_at?: string | null;
          contact_person?: string | null;
          country?: string;
          created_at?: string;
          default_locale?: string;
          default_sender_name?: string | null;
          dic?: string | null;
          dpa_document_path?: string | null;
          dpa_signed_at?: string | null;
          email?: string | null;
          ico?: string | null;
          id?: string;
          lifecycle_computed_at?: string | null;
          logo_path?: string | null;
          name: string;
          opening_hours?: NonNullable<Json>;
          phone?: string | null;
          postal_code?: string | null;
          preferred_channel?: string;
          requires_client_approval?: boolean;
          sending_enabled?: boolean;
          service_mode?: Database["public"]["Enums"]["service_mode"];
          settings?: NonNullable<Json>;
          status?: string;
          subscription_price_minor?: number;
          timezone?: string;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          address_line?: string | null;
          average_job_value_minor?: number;
          city?: string | null;
          closed_at?: string | null;
          contact_person?: string | null;
          country?: string;
          created_at?: string;
          default_locale?: string;
          default_sender_name?: string | null;
          dic?: string | null;
          dpa_document_path?: string | null;
          dpa_signed_at?: string | null;
          email?: string | null;
          ico?: string | null;
          id?: string;
          lifecycle_computed_at?: string | null;
          logo_path?: string | null;
          name?: string;
          opening_hours?: NonNullable<Json>;
          phone?: string | null;
          postal_code?: string | null;
          preferred_channel?: string;
          requires_client_approval?: boolean;
          sending_enabled?: boolean;
          service_mode?: Database["public"]["Enums"]["service_mode"];
          settings?: NonNullable<Json>;
          status?: string;
          subscription_price_minor?: number;
          timezone?: string;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      company_monthly_stats: {
        Row: {
          booked_count: number;
          company_id: string;
          completed_count: number;
          computed_at: string;
          holdout_stats: NonNullable<Json>;
          messages_sent: number;
          month: string;
          recovered_revenue_minor: number;
          sms_cost_minor: number;
          sms_segments: number;
        };
        Insert: {
          booked_count?: number;
          company_id: string;
          completed_count?: number;
          computed_at?: string;
          holdout_stats?: NonNullable<Json>;
          messages_sent?: number;
          month: string;
          recovered_revenue_minor?: number;
          sms_cost_minor?: number;
          sms_segments?: number;
        };
        Update: {
          booked_count?: number;
          company_id?: string;
          completed_count?: number;
          computed_at?: string;
          holdout_stats?: NonNullable<Json>;
          messages_sent?: number;
          month?: string;
          recovered_revenue_minor?: number;
          sms_cost_minor?: number;
          sms_segments?: number;
        };
        Relationships: [
          {
            foreignKeyName: "company_monthly_stats_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      conversions: {
        Row: {
          booked_at: string | null;
          campaign_id: string;
          company_id: string;
          completed_at: string | null;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          customer_id: string;
          enrollment_id: string;
          id: string;
          is_holdout: boolean;
          notes: string | null;
          revenue_minor: number | null;
          source: Database["public"]["Enums"]["conversion_source"];
          stage: Database["public"]["Enums"]["conversion_stage"];
          updated_at: string;
          vehicle_id: string | null;
          visit_id: string | null;
        };
        Insert: {
          booked_at?: string | null;
          campaign_id: string;
          company_id: string;
          completed_at?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          customer_id: string;
          enrollment_id: string;
          id?: string;
          is_holdout?: boolean;
          notes?: string | null;
          revenue_minor?: number | null;
          source: Database["public"]["Enums"]["conversion_source"];
          stage: Database["public"]["Enums"]["conversion_stage"];
          updated_at?: string;
          vehicle_id?: string | null;
          visit_id?: string | null;
        };
        Update: {
          booked_at?: string | null;
          campaign_id?: string;
          company_id?: string;
          completed_at?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          customer_id?: string;
          enrollment_id?: string;
          id?: string;
          is_holdout?: boolean;
          notes?: string | null;
          revenue_minor?: number | null;
          source?: Database["public"]["Enums"]["conversion_source"];
          stage?: Database["public"]["Enums"]["conversion_stage"];
          updated_at?: string;
          vehicle_id?: string | null;
          visit_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "conversions_campaign_id_company_id_fkey";
            columns: ["campaign_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "conversions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversions_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "conversions_enrollment_id_company_id_fkey";
            columns: ["enrollment_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaign_enrollments";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "conversions_vehicle_id_company_id_fkey";
            columns: ["vehicle_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "conversions_visit_id_company_id_fkey";
            columns: ["visit_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      customers: {
        Row: {
          company_id: string;
          created_at: string;
          eligibility_reason: string | null;
          email: string | null;
          external_id: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          last_visit_at: string | null;
          legal_basis: Database["public"]["Enums"]["legal_basis"];
          legal_basis_recorded_at: string | null;
          legal_basis_source: string | null;
          lifecycle_status: Database["public"]["Enums"]["lifecycle_status"];
          lifetime_value_minor: number;
          notes: string | null;
          phone_e164: string | null;
          phone_type: string;
          retention_flagged_at: string | null;
          search_name: string | null;
          source_import_id: string | null;
          updated_at: string;
          visit_count: number;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          eligibility_reason?: string | null;
          email?: string | null;
          external_id?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          last_visit_at?: string | null;
          legal_basis?: Database["public"]["Enums"]["legal_basis"];
          legal_basis_recorded_at?: string | null;
          legal_basis_source?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          lifetime_value_minor?: number;
          notes?: string | null;
          phone_e164?: string | null;
          phone_type?: string;
          retention_flagged_at?: string | null;
          search_name?: never;
          source_import_id?: string | null;
          updated_at?: string;
          visit_count?: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          eligibility_reason?: string | null;
          email?: string | null;
          external_id?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          last_visit_at?: string | null;
          legal_basis?: Database["public"]["Enums"]["legal_basis"];
          legal_basis_recorded_at?: string | null;
          legal_basis_source?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          lifetime_value_minor?: number;
          notes?: string | null;
          phone_e164?: string | null;
          phone_type?: string;
          retention_flagged_at?: string | null;
          search_name?: never;
          source_import_id?: string | null;
          updated_at?: string;
          visit_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      import_mapping_templates: {
        Row: {
          company_id: string;
          mapping: NonNullable<Json>;
          type: string;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          mapping: NonNullable<Json>;
          type: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          mapping?: NonNullable<Json>;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_mapping_templates_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      import_rows: {
        Row: {
          company_id: string;
          id: number;
          import_id: string;
          issues: NonNullable<Json>;
          match_customer_id: string | null;
          normalized: Json | null;
          raw: NonNullable<Json>;
          row_number: number;
          status: string;
        };
        Insert: {
          company_id: string;
          id?: never;
          import_id: string;
          issues?: NonNullable<Json>;
          match_customer_id?: string | null;
          normalized?: Json | null;
          raw: NonNullable<Json>;
          row_number: number;
          status?: string;
        };
        Update: {
          company_id?: string;
          id?: never;
          import_id?: string;
          issues?: NonNullable<Json>;
          match_customer_id?: string | null;
          normalized?: Json | null;
          raw?: NonNullable<Json>;
          row_number?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_rows_import_id_company_id_fkey";
            columns: ["import_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      imports: {
        Row: {
          company_id: string;
          completed_at: string | null;
          counts: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          delimiter: string | null;
          encoding: string | null;
          error: string | null;
          file_name: string | null;
          file_path: string | null;
          file_size_bytes: number | null;
          header: NonNullable<Json>;
          id: string;
          legal_basis_confirmed_at: string | null;
          legal_basis_confirmed_by: string | null;
          legal_basis_declared: Database["public"]["Enums"]["legal_basis"] | null;
          mapping: Json | null;
          preview: NonNullable<Json>;
          progress: NonNullable<Json>;
          row_count: number;
          sheet: string | null;
          sheet_names: NonNullable<Json>;
          status: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          completed_at?: string | null;
          counts?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          delimiter?: string | null;
          encoding?: string | null;
          error?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size_bytes?: number | null;
          header?: NonNullable<Json>;
          id?: string;
          legal_basis_confirmed_at?: string | null;
          legal_basis_confirmed_by?: string | null;
          legal_basis_declared?: Database["public"]["Enums"]["legal_basis"] | null;
          mapping?: Json | null;
          preview?: NonNullable<Json>;
          progress?: NonNullable<Json>;
          row_count?: number;
          sheet?: string | null;
          sheet_names?: NonNullable<Json>;
          status?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          completed_at?: string | null;
          counts?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          delimiter?: string | null;
          encoding?: string | null;
          error?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          file_size_bytes?: number | null;
          header?: NonNullable<Json>;
          id?: string;
          legal_basis_confirmed_at?: string | null;
          legal_basis_confirmed_by?: string | null;
          legal_basis_declared?: Database["public"]["Enums"]["legal_basis"] | null;
          mapping?: Json | null;
          preview?: NonNullable<Json>;
          progress?: NonNullable<Json>;
          row_count?: number;
          sheet?: string | null;
          sheet_names?: NonNullable<Json>;
          status?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "imports_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          company_id: string;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["company_role"];
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          company_id: string;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          invited_by?: string | null;
          role: Database["public"]["Enums"]["company_role"];
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          company_id?: string;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["company_role"];
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["company_role"];
          user_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["company_role"];
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["company_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      message_events: {
        Row: {
          company_id: string | null;
          id: number;
          message_id: string | null;
          payload: NonNullable<Json>;
          processed_at: string | null;
          provider_event_id: string;
          provider_id: string;
          received_at: string;
          type: string;
        };
        Insert: {
          company_id?: string | null;
          id?: never;
          message_id?: string | null;
          payload: NonNullable<Json>;
          processed_at?: string | null;
          provider_event_id: string;
          provider_id: string;
          received_at?: string;
          type: string;
        };
        Update: {
          company_id?: string | null;
          id?: never;
          message_id?: string | null;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          provider_event_id?: string;
          provider_id?: string;
          received_at?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "message_events_message_id_company_id_fkey";
            columns: ["message_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      messages: {
        Row: {
          attempts: number;
          body_rendered: string;
          campaign_id: string | null;
          channel: string;
          company_id: string;
          cost_minor: number | null;
          customer_id: string | null;
          delivered_at: string | null;
          encoding: string | null;
          enrollment_id: string | null;
          error_code: string | null;
          error_detail: string | null;
          failed_at: string | null;
          id: string;
          idempotency_key: string;
          next_attempt_at: string | null;
          opt_out_token: string;
          opted_out_at: string | null;
          provider_id: string | null;
          provider_message_id: string | null;
          queued_at: string;
          segments: number | null;
          sending_started_at: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["message_status"];
          step_id: string | null;
          step_number: number;
          to_address: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          body_rendered: string;
          campaign_id?: string | null;
          channel?: string;
          company_id: string;
          cost_minor?: number | null;
          customer_id?: string | null;
          delivered_at?: string | null;
          encoding?: string | null;
          enrollment_id?: string | null;
          error_code?: string | null;
          error_detail?: string | null;
          failed_at?: string | null;
          id?: string;
          idempotency_key: string;
          next_attempt_at?: string | null;
          opt_out_token: string;
          opted_out_at?: string | null;
          provider_id?: string | null;
          provider_message_id?: string | null;
          queued_at?: string;
          segments?: number | null;
          sending_started_at?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["message_status"];
          step_id?: string | null;
          step_number?: number;
          to_address: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          body_rendered?: string;
          campaign_id?: string | null;
          channel?: string;
          company_id?: string;
          cost_minor?: number | null;
          customer_id?: string | null;
          delivered_at?: string | null;
          encoding?: string | null;
          enrollment_id?: string | null;
          error_code?: string | null;
          error_detail?: string | null;
          failed_at?: string | null;
          id?: string;
          idempotency_key?: string;
          next_attempt_at?: string | null;
          opt_out_token?: string;
          opted_out_at?: string | null;
          provider_id?: string | null;
          provider_message_id?: string | null;
          queued_at?: string;
          segments?: number | null;
          sending_started_at?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["message_status"];
          step_id?: string | null;
          step_number?: number;
          to_address?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_company_id_fkey";
            columns: ["campaign_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "messages_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "messages_enrollment_id_company_id_fkey";
            columns: ["enrollment_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaign_enrollments";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "messages_step_id_company_id_fkey";
            columns: ["step_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "campaign_steps";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      name_vocatives: {
        Row: {
          company_id: string;
          confidence: number;
          created_at: string;
          gender: string;
          id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: string;
          surname: string;
          updated_at: string;
          vocative: string;
        };
        Insert: {
          company_id: string;
          confidence: number;
          created_at?: string;
          gender?: string;
          id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source: string;
          surname: string;
          updated_at?: string;
          vocative: string;
        };
        Update: {
          company_id?: string;
          confidence?: number;
          created_at?: string;
          gender?: string;
          id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string;
          surname?: string;
          updated_at?: string;
          vocative?: string;
        };
        Relationships: [
          {
            foreignKeyName: "name_vocatives_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      platform_settings: {
        Row: {
          id: boolean;
          last_health_check_at: string | null;
          sending_paused: boolean;
          sending_paused_at: string | null;
          sending_paused_by: string | null;
          sending_paused_reason: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          last_health_check_at?: string | null;
          sending_paused?: boolean;
          sending_paused_at?: string | null;
          sending_paused_by?: string | null;
          sending_paused_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          last_health_check_at?: string | null;
          sending_paused?: boolean;
          sending_paused_at?: string | null;
          sending_paused_by?: string | null;
          sending_paused_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          locale: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          locale?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          locale?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          hits: number;
          key: string;
          window_start: string;
        };
        Insert: {
          hits?: number;
          key: string;
          window_start: string;
        };
        Update: {
          hits?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      segments: {
        Row: {
          archived_at: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          preset_key: string | null;
          rules: NonNullable<Json>;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          preset_key?: string | null;
          rules: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          preset_key?: string | null;
          rules?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "segments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      service_category_mappings: {
        Row: {
          category: Database["public"]["Enums"]["service_category"];
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          raw_value_norm: string;
        };
        Insert: {
          category: Database["public"]["Enums"]["service_category"];
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          raw_value_norm: string;
        };
        Update: {
          category?: Database["public"]["Enums"]["service_category"];
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          raw_value_norm?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_category_mappings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      suppression_list: {
        Row: {
          address_hash: string;
          channel: string;
          company_id: string;
          created_at: string;
          id: string;
          reason: string;
        };
        Insert: {
          address_hash: string;
          channel?: string;
          company_id: string;
          created_at?: string;
          id?: string;
          reason: string;
        };
        Update: {
          address_hash?: string;
          channel?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppression_list_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicles: {
        Row: {
          brand: string | null;
          company_id: string;
          created_at: string;
          customer_id: string;
          id: string;
          last_visit_at: string | null;
          license_plate_display: string | null;
          license_plate_norm: string | null;
          lifecycle_status: Database["public"]["Enums"]["lifecycle_status"];
          model: string | null;
          model_year: number | null;
          updated_at: string;
          vin: string | null;
        };
        Insert: {
          brand?: string | null;
          company_id: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          last_visit_at?: string | null;
          license_plate_display?: string | null;
          license_plate_norm?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          model?: string | null;
          model_year?: number | null;
          updated_at?: string;
          vin?: string | null;
        };
        Update: {
          brand?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          last_visit_at?: string | null;
          license_plate_display?: string | null;
          license_plate_norm?: string | null;
          lifecycle_status?: Database["public"]["Enums"]["lifecycle_status"];
          model?: string | null;
          model_year?: number | null;
          updated_at?: string;
          vin?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vehicles_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      visits: {
        Row: {
          company_id: string;
          created_at: string;
          customer_id: string;
          external_ref: string | null;
          id: string;
          job_value_minor: number | null;
          service_category: Database["public"]["Enums"]["service_category"];
          service_label_norm: string | null;
          service_type_raw: string | null;
          source_import_id: string | null;
          vehicle_id: string | null;
          visited_at: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          customer_id: string;
          external_ref?: string | null;
          id?: string;
          job_value_minor?: number | null;
          service_category?: Database["public"]["Enums"]["service_category"];
          service_label_norm?: never;
          service_type_raw?: string | null;
          source_import_id?: string | null;
          vehicle_id?: string | null;
          visited_at: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          external_ref?: string | null;
          id?: string;
          job_value_minor?: number | null;
          service_category?: Database["public"]["Enums"]["service_category"];
          service_label_norm?: never;
          service_type_raw?: string | null;
          source_import_id?: string | null;
          vehicle_id?: string | null;
          visited_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "visits_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "visits_vehicle_id_company_id_fkey";
            columns: ["vehicle_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "vehicles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      alert_inputs: {
        Args: Record<PropertyKey, never>;
        Returns: {
          campaigns: Json;
          company_created_at: string;
          company_id: string;
          company_status: string;
          delivered_recent: number;
          imports: Json;
          last_send_at: string;
          undelivered_recent: number;
        }[];
      };
      campaign_audience: {
        Args: { p_campaign_id: string; p_company_id: string; p_today: string };
        Returns: {
          customer_id: string;
          first_name: string;
          last_name: string;
          last_visit_at: string;
          phone_e164: string;
          plate: string;
          vehicle_brand: string;
          vehicle_id: string;
          vehicle_model: string;
        }[];
      };
      campaign_delivery_stats: {
        Args: { p_campaign_id: string; p_company_id: string };
        Returns: {
          cost_minor: number;
          messages: number;
          segments: number;
          status: Database["public"]["Enums"]["message_status"];
          step_number: number;
        }[];
      };
      campaign_summaries: {
        Args: { p_company_id: string };
        Returns: {
          attribution_window_days: number;
          booked: number;
          completed: number;
          contacted: number;
          holdout: number;
          holdout_completed: number;
          id: string;
          name: string;
          revenue_minor: number;
          scheduled_at: string;
          segment_preset: string;
          sms_cost_minor: number;
          started_at: string;
          status: Database["public"]["Enums"]["campaign_status"];
        }[];
      };
      claim_messages: {
        Args: { p_limit: number; p_now: string };
        Returns: {
          attempts: number;
          body_rendered: string;
          campaign_id: string;
          company_id: string;
          enrollment_id: string;
          id: string;
          idempotency_key: string;
          step_number: number;
          stop_reason: string;
          to_address: string;
        }[];
      };
      close_attribution_windows: { Args: { p_now: string }; Returns: number };
      commit_import_batch: {
        Args: { p_batch: number; p_company_id: string; p_import_id: string; p_payload: Json };
        Returns: Json;
      };
      due_followups: {
        Args: {
          p_campaign_id: string;
          p_company_id: string;
          p_delay_days: number;
          p_now: string;
          p_step_number: number;
        };
        Returns: {
          customer_id: string;
          enrollment_id: string;
          first_name: string;
          last_name: string;
          last_visit_at: string;
          phone_e164: string;
          plate: string;
          vehicle_brand: string;
          vehicle_model: string;
        }[];
      };
      flag_stuck_messages: { Args: { p_after?: string; p_now: string }; Returns: number };
      hit_rate_limit: {
        Args: { p_increment?: boolean; p_key: string; p_limit: number; p_now?: string; p_window_seconds: number };
        Returns: boolean;
      };
      job_value_median: {
        Args: { p_categories: Database["public"]["Enums"]["service_category"][]; p_company_id: string };
        Returns: {
          median_minor: number;
          visits: number;
        }[];
      };
      list_customers: {
        Args: {
          p_category?: Database["public"]["Enums"]["service_category"];
          p_company_id: string;
          p_digits?: string;
          p_eligibility?: string;
          p_last_visit?: string;
          p_limit?: number;
          p_lookback_months?: number;
          p_name?: string;
          p_offset?: number;
          p_plate?: string;
          p_status?: Database["public"]["Enums"]["lifecycle_status"];
          p_today: string;
        };
        Returns: {
          first_name: string;
          id: string;
          last_name: string;
          last_visit_at: string;
          lifecycle_status: Database["public"]["Enums"]["lifecycle_status"];
          phone_e164: string;
          phone_type: string;
          plate: string;
          total_count: number;
          vehicle: string;
          vehicle_count: number;
          visit_count: number;
        }[];
      };
      list_service_labels: {
        Args: { p_company_id: string };
        Returns: {
          category: Database["public"]["Enums"]["service_category"];
          example: string;
          label_norm: string;
          mapped: boolean;
          visits: number;
        }[];
      };
      messaging_queue_health: {
        Args: { p_now?: string };
        Returns: {
          failed_24h: number;
          needs_review: number;
          oldest_queued_at: string;
          queued: number;
          sending: number;
          sent_24h: number;
        }[];
      };
      recompute_lifecycle: {
        Args: { p_company_id: string; p_customer_ids?: string[]; p_today?: string };
        Returns: number;
      };
      recompute_monthly_stats: { Args: { p_company_id: string; p_from: string; p_to: string }; Returns: number };
      record_conversion: {
        Args: {
          p_action: string;
          p_at: string;
          p_company_id: string;
          p_enrollment_id: string;
          p_notes?: string;
          p_revenue_minor?: number;
          p_user?: string;
        };
        Returns: {
          booked_at: string | null;
          campaign_id: string;
          company_id: string;
          completed_at: string | null;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          customer_id: string;
          enrollment_id: string;
          id: string;
          is_holdout: boolean;
          notes: string | null;
          revenue_minor: number | null;
          source: Database["public"]["Enums"]["conversion_source"];
          stage: Database["public"]["Enums"]["conversion_stage"];
          updated_at: string;
          vehicle_id: string | null;
          visit_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "conversions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      run_retention: { Args: { p_now: string }; Returns: Json };
      segment_audience: {
        Args: { p_company_id: string; p_preset_key?: string; p_rules: Json; p_today?: string };
        Returns: {
          customer_id: string;
          last_visit_at: string;
          reason: string;
          vehicle_id: string;
        }[];
      };
      segment_preview: {
        Args: { p_company_id: string; p_preset_key?: string; p_rules: Json; p_today?: string };
        Returns: Json;
      };
      segment_recipients: {
        Args: { p_company_id: string; p_preset_key?: string; p_rules: Json; p_today?: string };
        Returns: {
          customer_id: string;
          first_name: string;
          last_name: string;
          last_visit_at: string;
          plate: string;
          vehicle_brand: string;
          vehicle_id: string;
          vehicle_model: string;
        }[];
      };
      set_import_row_results: { Args: { p_company_id: string; p_import_id: string; p_rows: Json }; Returns: number };
      set_service_category: {
        Args: {
          p_category: Database["public"]["Enums"]["service_category"];
          p_company_id: string;
          p_label_norm: string;
        };
        Returns: number;
      };
      vocative_candidates: {
        Args: { p_company_id: string; p_limit?: number };
        Returns: {
          surname: string;
        }[];
      };
    };
    Enums: {
      campaign_status:
        | "draft"
        | "waiting_for_approval"
        | "scheduled"
        | "sending"
        | "active"
        | "paused"
        | "completed"
        | "cancelled"
        | "failed";
      company_role: "shop_owner" | "shop_manager";
      conversion_source: "manual_confirmed" | "import_matched" | "manual_unverified";
      conversion_stage: "contacted" | "replied" | "booked" | "completed" | "lost" | "opted_out";
      legal_basis: "consent" | "existing_customer" | "unknown";
      lifecycle_status: "active" | "at_risk" | "inactive" | "reactivated" | "opted_out";
      message_status:
        | "queued"
        | "sending"
        | "sent"
        | "delivered"
        | "undelivered"
        | "expired"
        | "failed"
        | "cancelled"
        | "needs_review";
      service_category:
        | "regular_service"
        | "oil_change"
        | "tyre_change"
        | "tyre_storage"
        | "ac_service"
        | "brakes"
        | "diagnostics"
        | "stk"
        | "repair_other";
      service_mode: "managed" | "self_service";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      campaign_status: [
        "draft",
        "waiting_for_approval",
        "scheduled",
        "sending",
        "active",
        "paused",
        "completed",
        "cancelled",
        "failed",
      ],
      company_role: ["shop_owner", "shop_manager"],
      conversion_source: ["manual_confirmed", "import_matched", "manual_unverified"],
      conversion_stage: ["contacted", "replied", "booked", "completed", "lost", "opted_out"],
      legal_basis: ["consent", "existing_customer", "unknown"],
      lifecycle_status: ["active", "at_risk", "inactive", "reactivated", "opted_out"],
      message_status: [
        "queued",
        "sending",
        "sent",
        "delivered",
        "undelivered",
        "expired",
        "failed",
        "cancelled",
        "needs_review",
      ],
      service_category: [
        "regular_service",
        "oil_change",
        "tyre_change",
        "tyre_storage",
        "ac_service",
        "brakes",
        "diagnostics",
        "stk",
        "repair_other",
      ],
      service_mode: ["managed", "self_service"],
    },
  },
} as const;
